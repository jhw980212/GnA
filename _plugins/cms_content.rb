# Build a catalog of existing public content and apply CMS changes without
# overwriting the original Markdown files or citation data.
require "digest"
require "json"
require "yaml"
require "date"
require "fileutils"

module LabCms
  class CatalogFile < Jekyll::StaticFile
    def initialize(site, payload)
      super(site, site.source, "content", "cms-source-catalog.json")
      @payload = JSON.generate(payload)
    end

    def write(output_root)
      target = destination(output_root)
      FileUtils.mkdir_p(File.dirname(target))
      File.binwrite(target, @payload)
      true
    end
  end

  class ContentGenerator < Jekyll::Generator
    safe true
    priority :high

    def generate(site)
      entries = []
      %w[blog notice].each do |name|
        collection = site.collections[name]
        next unless collection

        originals = collection.docs.reject { |doc| cms_document?(doc) }
        originals.each { |doc| entries << post_entry(site, doc, name) }
        apply_post_overrides(collection, originals, name)
      end

      citations = site.data["citations"] || []
      citation_path = "_data/citations.yaml"
      if File.file?(site.in_source_dir(citation_path))
        sha = blob_sha(File.binread(site.in_source_dir(citation_path)))
        citations.each do |record|
          entries << { "collection" => "publication", "path" => citation_path,
                       "sha" => sha, "sourceId" => source_id(record), "record" => record }
        end
      end
      site.data["cms_effective_publications"] = merge_publications(citations, site.data["cms-publications"] || [])
      site.static_files << CatalogFile.new(site, { "version" => 1, "entries" => entries })
    end

    private

    def cms_document?(doc)
      File.basename(doc.path).match?(/\Acms-[a-f0-9]{32}\.md\z/)
    end

    def blob_sha(raw)
      Digest::SHA1.hexdigest("blob #{raw.bytesize}\0".b + raw.b)
    end

    def source_id(record)
      id = record["id"].to_s
      return id unless id.empty?

      "legacy:" + Digest::SHA256.hexdigest(record.fetch("link"))
    end

    def post_entry(site, doc, collection)
      raw = File.binread(doc.path)
      text = raw.dup.force_encoding("UTF-8").sub(/\A\uFEFF/, "")
      match = /\A---[ \t]*\r?\n(.*?)^---[ \t]*(?:\r?\n|\z)/m.match(text)
      raise "CMS catalog: missing front matter in #{doc.relative_path}" unless match

      front = YAML.safe_load(match[1], permitted_classes: [Date, Time], aliases: false) || {}
      date = doc.data["date"]
      date = date.respond_to?(:strftime) ? date.strftime("%Y-%m-%d") : date.to_s[0, 10]
      relative = doc.path.delete_prefix(site.source + File::SEPARATOR).tr("\\", "/")
      { "collection" => collection, "path" => relative, "sha" => blob_sha(raw),
        "url" => doc.url, "title" => front["title"].to_s, "date" => date,
        "excerpt" => (front["summary"] || front["description"] || "").to_s,
        "image" => front["image"], "image_alt" => front["image_alt"],
        "image_caption" => front["image_caption"], "frontMatter" => front,
        "body" => text[match.end(0)..] }
    end

    def apply_post_overrides(collection, originals, name)
      originals_by_path = originals.to_h { |doc| [doc.relative_path.sub(%r{\A/}, ""), doc] }
      seen = {}
      removed = []
      collection.docs.each do |doc|
        source = doc.data["cms_source_path"]
        next unless source

        unless cms_document?(doc) && source.is_a?(String) && source.start_with?("_#{name}/") && originals_by_path[source]
          raise "CMS override: original #{name} entry was not found"
        end
        raise "CMS override: duplicate source #{source}" if seen[source]

        seen[source] = true
        original = originals_by_path[source]
        unless doc.url == original.url
          raise "CMS override: original URL must be preserved for #{source}"
        end
        removed << original
        removed << doc if doc.data["cms_hidden"] == true
      end
      collection.docs.reject! { |doc| removed.include?(doc) }
    end

    def merge_publications(originals, overrides)
      raise "CMS publications must be a list" unless overrides.is_a?(Array)

      replacements = {}
      additions = []
      original_ids = originals.map { |record| source_id(record) }
      overrides.each do |record|
        source = record["sourceId"]
        if source
          raise "CMS publication source no longer exists" unless original_ids.include?(source)
          raise "CMS publication source was used twice" if replacements.key?(source)

          replacements[source] = record
        elsif record["cms_hidden"] != true
          additions << record
        end
      end
      originals.filter_map do |record|
        replacement = replacements[source_id(record)]
        next if replacement && replacement["cms_hidden"] == true

        replacement || record
      end + additions
    end
  end
end
