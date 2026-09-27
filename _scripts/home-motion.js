/* Original scroll-driven illustrations: no recorded participant data or clinical simulation.
 * Scroll selects the activity, advances its movement and transitions the camera/body.
 * Nothing continuously loops when scrolling stops. All geometry is generated locally.
 */
(() => {
  'use strict';
  const story = document.querySelector('[data-motion-story]');
  if (!story) return;
  const study = story.querySelector('[data-motion-study]');
  const stage = study.querySelector('.motion-stage');
  const canvas = study.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const chapters = [...story.querySelectorAll('[data-chapter]')];
  const links = [...story.querySelectorAll('.story-steps a')];
  const panels = [...story.querySelectorAll('.signal-panel')];
  const traces = panels.map(panel => panel.querySelector('.signal-trace'));
  const shortScreen = matchMedia('(max-height: 700px) and (max-width: 760px), (max-height: 650px)');
  const TAU = Math.PI * 2;
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
  const fract = t => t - Math.floor(t);
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, n) => a.map(v => v * n);
  const lerp = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const norm = a => mul(a, 1 / (Math.hypot(...a) || 1));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sceneInfo = [
    { name: 'EVERYDAY MOVEMENT', description: 'An illustrative older adult walking with modelled ECG, vertical trunk acceleration and single-foot ground reaction force synchronized to the gait cycle.', signals: [['Cardiac rhythm', 'ECG'], ['Trunk acceleration', 'VERTICAL ACCELERATION'], ['Ground contact', 'SINGLE-FOOT FORCE']] },
    { name: 'EXERCISE & PERFORMANCE', description: 'An illustrative runner with modelled ECG, vertical trunk acceleration and single-foot ground reaction force, synchronized to the running cycle.', signals: [['Cardiac response', 'ECG'], ['Trunk acceleration', 'VERTICAL ACCELERATION'], ['Ground reaction', 'SINGLE-FOOT FORCE']] },
    { name: 'CONTROLLED EXERCISE', description: 'An illustrative cycle ergometer with modelled ECG, crank angle and pedal power synchronized to forward pedalling.', signals: [['Cardiac response', 'ECG'], ['Crank angle', 'PEDAL ROTATION'], ['Pedal power', 'CYCLIC POWER']] },
    { name: 'ISOKINETIC ASSESSMENT', description: 'An illustrative dynamometer with modelled knee flexion angle, joint torque and angular velocity. Extension and return have constant-speed middle phases and smooth reversals.', signals: [['Knee flexion', 'JOINT ANGLE'], ['Joint torque', 'EXTENSION / FLEXION'], ['Angular velocity', 'EXTENSION POSITIVE']] },
    { name: 'BODY COMPOSITION & BONE', description: 'An illustrative DXA scan reveals fixed example lean mass, fat mass and bone density for head, arms, trunk and legs as each region is scanned; these are not time-varying tissue measurements.', signals: [['Lean mass', 'REGIONAL COMPOSITION'], ['Fat mass', 'REGIONAL COMPOSITION'], ['Bone density', 'REGIONAL BMD']] },
  ];
  // Match each measurement marker and instrument accent to its signal panel.
  // Cardiac = coral, movement = blue, force/load = amber; DXA composition = lilac.
  const signalPalettes = [
    ['#f29a8d', '#83baff', '#e8bd78'],
    ['#f29a8d', '#83baff', '#e8bd78'],
    ['#f29a8d', '#83baff', '#e8bd78'],
    ['#83baff', '#e8bd78', '#b8a4ec'],
    ['#b8a4ec', '#f29a8d', '#e8bd78'],
  ];
  let width = 700, height = 550, current = 0, target = 0, frame = 0;
  let active = -1, destinations = [], visible = true;
  let geometryTop = 0, geometryRange = 1, headerHeight = 84;
  const samples = Array.from({ length: 1000 }, (_, i) => ({ angle: i * 2.3999632297, size: .42 + fract(i * .618) * .62 }));

  // Smooth periodic keyframes describe contact, push-off, recovery and landing.
  function gaitValue(keys, phase, continuous = false) {
    let i = 0;
    while (i < keys.length - 2 && phase > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1];
    const t = clamp((phase - a[0]) / (b[0] - a[0]));
    if (!continuous) return mix(a[1], b[1], smooth(t));
    // Periodic monotone Hermite interpolation avoids stopping at each gait landmark.
    const slope = index => {
      const k = index === keys.length - 1 ? 0 : index;
      const previous = k ? keys[k - 1] : [keys[keys.length - 2][0] - 1, keys[keys.length - 2][1]];
      const point = keys[k], next = keys[k + 1];
      const before = (point[1] - previous[1]) / (point[0] - previous[0]);
      const after = (next[1] - point[1]) / (next[0] - point[0]);
      return before * after <= 0 ? 0 : 2 * before * after / (before + after);
    };
    const span = b[0] - a[0], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[1] + (t3 - 2 * t2 + t) * span * slope(i)
      + (-2 * t3 + 3 * t2) * b[1] + (t3 - t2) * span * slope(i + 1);
  }
  // +z is forward. At the top of a revolution the pedal moves toward +z.
  function pedalPosition(theta, side) {
    const angle = theta + (side === 1 ? Math.PI : 0);
    return [side * .13, .36 + .18 * Math.cos(angle), .20 + .18 * Math.sin(angle)];
  }

  // Two-segment inverse kinematics, keeping limb lengths consistent.
  function joint(start, end, a, b, bend = [0, 0, 1]) {
    const delta = sub(end, start), distance = clamp(Math.hypot(...delta), .001, a + b - .001);
    const axis = norm(delta);
    const direction = norm(sub(bend, mul(axis, dot(bend, axis))));
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    return add(add(start, mul(axis, along)), mul(direction, Math.sqrt(Math.max(0, a * a - along * along))));
  }

  const motionPhase = progress => .18 + progress * 2.7;
  // Chosen demonstration parameters, not population norms or participant data.
  // Walk/run cadence is steps/min; one phase cycle contains two steps.
  const signalModels = [
    { period: 120 / 90, bpm: 84, ranges: [[-.5, 1.3], [.8, 1.2], [0, 1.4]] },
    { period: 120 / 160, bpm: 144, ranges: [[-.5, 1.3], [-.2, 2.2], [0, 3]] },
    { period: 60 / 75, bpm: 120, watts: 100, ranges: [[-.5, 1.3], [0, 360], [0, 180]] },
    { period: 2 * 70 / (60 * .88), ranges: [[0, 100], [-100, 200], [-75, 75]] },
  ];
  function kneeState(phase) {
    const cycle = fract(phase), extending = cycle < .5;
    const u = fract(cycle * 2), edge = .12;
    const ramp = u < edge ? u * u / (2 * edge * (1 - edge))
      : u > 1 - edge ? 1 - (1 - u) ** 2 / (2 * edge * (1 - edge))
      : (u - edge / 2) / (1 - edge);
    const speed = 60 * Math.min(u / edge, 1, (1 - u) / edge);
    const angle = extending ? 90 - 70 * ramp : 20 + 70 * ramp;
    const effort = Math.sin(Math.PI * u) ** 1.2;
    return { angle, velocity: speed * (extending ? 1 : -1), torque: effort * (extending ? 180 : -80) };
  }
  function pose(mode, progress) {
    const phase = motionPhase(progress);
    const theta = phase * TAU;
    const older = mode === 0;
    const running = mode === 1;
    const hipY = running ? .865 - .035 * Math.cos((phase - .18) * TAU * 2) : .815 + .008 * Math.cos(theta * 2);
    const sway = (running ? .012 : .015) * Math.sin(theta);
    let p = { hip: [sway, hipY, 0], chest: [-sway * .4, hipY + .38, older ? .11 : .10], neck: [-sway * .3, hipY + .57, older ? .20 : .15], head: [-sway * .2, hipY + .70, older ? .22 : .17] };
    for (const side of [-1, 1]) {
      const cycle = fract(phase + (side === 1 ? .5 : 0));
      const hip = [sway + side * .10, hipY, side * .014 * Math.sin(theta)];
      let ankle, pitch;
      if (running) {
        const z = gaitValue([[0,.23],[.12,.06],[.34,-.34],[.50,-.43],[.68,.03],[.84,.36],[1,.23]], cycle, true);
        const y = gaitValue([[0,.08],[.12,.068],[.34,.13],[.50,.56],[.68,.48],[.84,.25],[1,.08]], cycle, true);
        pitch = gaitValue([[0,-.10],[.12,0],[.34,-.55],[.50,-.9],[.68,-.45],[.84,.12],[1,-.10]], cycle, true);
        ankle = [side * .095, y, z];
      } else {
        const swing = clamp((cycle - .64) / .36);
        const z = cycle < .64 ? mix(.18, -.18, cycle / .64) : mix(-.18, .18, smooth(swing));
        pitch = gaitValue([[0,.12],[.14,0],[.43,0],[.64,-.36],[.80,.08],[1,.12]], cycle);
        ankle = [side * .115, .066 + (cycle < .64 ? 0 : .075 * Math.sin(swing * Math.PI)), z];
      }
      ankle[1] = Math.max(ankle[1], .045 - .15 * Math.sin(pitch));
      const knee = joint(hip, ankle, running ? .46 : .43, running ? .46 : .43);
      const shoulder = add(p.chest, [side * .18, .075, -side * .035 * Math.sin(theta)]);
      const thigh = Math.atan2(knee[2] - hip[2], hip[1] - knee[1]);
      const arm = running ? -.85 * thigh + .05 : -.65 * Math.atan2(ankle[2], hipY - ankle[1]);
      const elbow = add(shoulder, [side * .025, -.28 * Math.cos(arm), .28 * Math.sin(arm)]);
      const forearm = arm + (running ? 1.42 : .30);
      const hand = add(elbow, [-side * .045, -.26 * Math.cos(forearm), .26 * Math.sin(forearm)]);
      p[side] = { hip, knee, ankle, shoulder, elbow, hand, footDirection: [0, Math.sin(pitch), Math.cos(pitch)] };
    }
    if (mode === 2) {
      p.hip = [0, .91, -.24]; p.chest = [0, 1.21, .02]; p.neck = [0, 1.38, .18]; p.head = [0, 1.49, .22];
      for (const side of [-1, 1]) {
        const hip = add(p.hip, [side * .11, 0, 0]);
        const pedal = pedalPosition(theta, side);
        const ankle = add(pedal, [0, .045, -.055]);
        const shoulder = add(p.chest, [side * .18, .10, .035]);
        const hand = [side * .23, 1.16, .52];
        p[side] = { hip, ankle, pedal, knee: joint(hip, ankle, .43, .43), shoulder, hand, elbow: joint(shoulder, hand, .29, .28, [side, -.5, 0]), footDirection: [0, -.05, 1] };
      }
    }
    if (mode === 3) {
      p.hip = [0, .72, -.25]; p.chest = [0, 1.12, -.31]; p.neck = [0, 1.32, -.32]; p.head = [0, 1.45, -.31];
      for (const side of [-1, 1]) {
        const hip = add(p.hip, [side * .105, 0, 0]);
        const knee = [side * .105, .72, .18];
        const angle = side === -1 ? (90 - kneeState(phase).angle) * Math.PI / 180 : .1;
        const ankle = add(knee, [0, -.43 * Math.cos(angle), .43 * Math.sin(angle)]);
        const shoulder = add(p.chest, [side * .18, .10, 0]);
        const hand = [side * .23, .70, -.03];
        p[side] = { hip, knee, ankle, shoulder, hand, elbow: joint(shoulder, hand, .29, .27, [side, 0, .5]), footDirection: [0, Math.sin(angle), Math.cos(angle)] };
      }
    }
    if (mode === 4) {
      p.hip = [0, .56, -.08]; p.chest = [0, .58, -.46]; p.neck = [0, .58, -.66]; p.head = [0, .60, -.80];
      for (const side of [-1, 1]) {
        const hip = add(p.hip, [side * .105, 0, 0]);
        const knee = [side * .10, .54, .35];
        const ankle = [side * .10, .52, .78];
        const shoulder = [side * .18, .57, -.55];
        const elbow = [side * .25, .51, -.27];
        const hand = [side * .25, .50, -.015];
        p[side] = { hip, knee, ankle, shoulder, elbow, hand, footDirection: [0, 1, .15] };
      }
    }
    for (const side of [-1, 1]) {
      const limb = p[side];
      const forward = norm(limb.footDirection);
      const up = norm(cross(forward, [1, 0, 0]));
      limb.heel = add(limb.ankle, add(mul(up, -.026), mul(forward, -.045)));
      limb.toe = add(limb.ankle, add(mul(up, -.030), mul(forward, .15)));
      limb.pedal = limb.pedal || limb.ankle;
    }
    return p;
  }

  function blendPose(a, b, t) {
    const p = {};
    for (const key of ['hip', 'chest', 'neck', 'head']) p[key] = lerp(a[key], b[key], t);
    for (const side of [-1, 1]) { p[side] = {}; for (const key of Object.keys(a[side])) p[side][key] = lerp(a[side][key], b[side][key], t); }
    return p;
  }

  function bodyPoints(p, mode) {
    const points = [];
    function ellipsoid(center, radii, count, up = [0, 1, 0]) {
      const across = [1, 0, 0], forward = norm(cross(across, up));
      for (let i = 0; i < count; i++) {
        const y = 1 - 2 * (i + .5) / count, r = Math.sqrt(1 - y * y), sample = samples[i];
        const normal = norm(add(mul(up, y / radii[1]), add(mul(across, Math.cos(sample.angle) * r / radii[0]), mul(forward, Math.sin(sample.angle) * r / radii[2]))));
        points.push({ p: add(center, add(mul(up, y * radii[1]), add(mul(across, Math.cos(sample.angle) * r * radii[0]), mul(forward, Math.sin(sample.angle) * r * radii[2])))), normal, size: sample.size });
      }
    }
    function tube(a, b, r1, r2, count) {
      const axis = norm(sub(b, a));
      const tangent = norm(cross(axis, Math.abs(axis[0]) < .8 ? [1, 0, 0] : [0, 0, 1]));
      const bitangent = cross(axis, tangent);
      for (let i = 0; i < count; i++) {
        const u = (i + .5) / count, sample = samples[i];
        const radius = mix(r1, r2, u) * (.78 + .22 * Math.sin(Math.PI * u));
        const normal = add(mul(tangent, Math.cos(sample.angle)), mul(bitangent, Math.sin(sample.angle)));
        points.push({ p: add(lerp(a, b, u), mul(normal, radius)), normal, size: sample.size });
      }
    }
    const up = norm(sub(p.neck, p.chest));
    const forward = norm(cross([1, 0, 0], up));
    // A single smooth head silhouette, without separate facial features.
    ellipsoid(p.head, [.080, .112, .094], 400, up);
    tube(add(p.neck, mul(up, -.025)), add(p.head, mul(up, -.085)), .041, .039, 55);
    for (let i = 0; i < 800; i++) {
      const u = (i + .5) / 800, angle = samples[i].angle;
      const center = u < .65 ? lerp(p.hip, p.chest, u / .65) : lerp(p.chest, p.neck, (u - .65) / .35);
      const rx = gaitValue([[0,.133],[.25,.118],[.60,.182],[.79,.177],[1,.042]], u);
      const rz = gaitValue([[0,.096],[.25,.087],[.62,.115],[.82,.095],[1,.044]], u);
      points.push({ p: add(center, add([Math.cos(angle) * rx, 0, 0], mul(forward, Math.sin(angle) * rz))), normal: norm(add([Math.cos(angle), 0, 0], mul(forward, Math.sin(angle)))), size: samples[i].size });
    }
    ellipsoid(p.hip, [.145, .115, .10], 120, up);
    for (const side of [-1, 1]) {
      const limb = p[side];
      tube(limb.hip, limb.knee, .087, .046, 300);
      ellipsoid(limb.knee, [.045, .048, .049], 60);
      const calf = lerp(limb.knee, limb.ankle, .36);
      tube(limb.knee, calf, .044, .061, 115);
      tube(calf, limb.ankle, .061, .025, 200);
      const shoeUp = norm(cross(norm(sub(limb.toe, limb.heel)), [1, 0, 0]));
      ellipsoid(lerp(limb.heel, limb.toe, .48), [.048, .039, .111], 145, shoeUp);
      ellipsoid(limb.shoulder, [.065, .070, .067], 75, up);
      tube(limb.shoulder, limb.elbow, .055, .032, 155);
      ellipsoid(limb.elbow, [.03, .035, .03], 35);
      tube(limb.elbow, limb.hand, .036, .022, 130);
      const handUp = norm(sub(limb.hand, limb.elbow));
      ellipsoid(add(limb.hand, mul(handUp, .026)), [.030, mode === 1 ? .036 : .05, .026], 75, handUp);
      ellipsoid(add(limb.hand, [side * -.018, -.005, .022]), [.014, .029, .017], 25, handUp);
    }
    return points;
  }

  let camera = { yaw: 1, unit: 225, center: 245, floor: 480 };
  function project(p) {
    const lateral = p[0] * Math.cos(camera.yaw) + p[2] * Math.sin(camera.yaw);
    const depth = -p[0] * Math.sin(camera.yaw) + p[2] * Math.cos(camera.yaw);
    return { x: camera.center + lateral * camera.unit, y: camera.floor - p[1] * camera.unit + depth * camera.unit * .18, depth };
  }
  function line(points, color = '#a9a9b170', lineWidth = 1) {
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.beginPath();
    points.forEach((p, i) => { const q = project(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
  }
  function plane(points, fill = '#bcbcc415', stroke = '#bcbcc461') {
    ctx.beginPath(); points.forEach((p, i) => { const q = project(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = .9; ctx.stroke();
  }
  function ring(center, radius, orientation = 'yz', color = '#aaaabb70') {
    const points = Array.from({ length: 61 }, (_, i) => { const angle = i / 60 * TAU; return add(center, orientation === 'yz' ? [0, Math.cos(angle) * radius, Math.sin(angle) * radius] : [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]); });
    line(points, color);
  }
  function ground() {
    for (const radius of [.5, .85, 1.18]) ring([0, -.015, 0], radius, 'xz', '#aaaabb16');
  }
  function footContact(mode, progress, p, opacity) {
    for (const side of [-1, 1]) {
      const foot = lerp(p[side].heel, p[side].toe, .5);
      const phase = motionPhase(progress) + (side === 1 ? .5 : 0);
      ctx.globalAlpha = opacity * clamp(groundForce(mode, phase) / (mode === 0 ? 1.1 : 2.4)) * .7;
      const contour = Array.from({ length: 25 }, (_, i) => { const a = i / 24 * TAU; return [foot[0] + .09 * Math.cos(a), -.01, foot[2] + .19 * Math.sin(a)]; });
      plane(contour, '#e8bd7812', '#e8bd7845');
    }
    ctx.globalAlpha = 1;
  }

  function equipment(mode, progress, p, alpha = 1) {
    if (alpha < .01) return;
    const colors = signalPalettes[mode];
    ctx.globalAlpha = alpha;
    if (mode === 0) {
      plane([[-.32, -.015, -.45], [.32, -.015, -.45], [.32, -.015, .45], [-.32, -.015, .45]], colors[2] + '0c', colors[2] + '70');
      line([[-.32, -.015, -.45], [-.32, -.07, -.45], [.32, -.07, -.45], [.32, -.015, -.45]], '#aaaabb40');
    }
    if (mode === 1) {
      for (const x of [-.50, .50]) {
        line([[x - .12, 0, .25], [x + .12, 0, .25]], '#c5c5cf80', 1.2);
        line([[x, 0, .25], [x, 1.10, .25]], '#c5c5cf80', 1.2);
        plane([[x - .045, 1.1, .22], [x + .045, 1.1, .22], [x + .045, 1.02, .28], [x - .045, 1.02, .28]], '#c5c5cf40');
      }
      ctx.setLineDash([3, 5]); line([[-.5, 1.06, .25], [.5, 1.06, .25]], colors[2] + '90'); ctx.setLineDash([]);
    }
    if (mode === 2) {
      const wheel = [0, .35, .37];
      ring(wheel, .31); ring(wheel, .26, 'yz', '#aaaabb36');
      const rotation = motionPhase(progress) * TAU;
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + rotation; line([wheel, add(wheel, [0, Math.cos(a) * .30, Math.sin(a) * .30])], i === 0 ? '#e5e5e594' : '#aaaabb30'); }
      line(Array.from({ length: 12 }, (_, i) => add(wheel, [0, .31 * Math.cos(rotation + i * .018), .31 * Math.sin(rotation + i * .018)])), colors[2], 2);
      line([[0, .09, -.48], [0, .80, -.24], [0, .35, .20], [0, .12, .54], [0, 1.1, .5]], '#d5d5dd8f', 2);
      line([[-.23, 1.16, .52], [.23, 1.16, .52]], '#d5d5dd', 2);
      plane([[-.15, .83, -.4], [.15, .83, -.4], [.15, .83, -.13], [-.15, .83, -.13]], '#bcbcc442');
      for (const z of [-.48, .54]) line([[-.31, .07, z], [.31, .07, z]], '#d5d5dd9a', 2);
      const crank = [0, .36, .20];
      for (const side of [-1, 1]) { line([crank, p[side].pedal], colors[1] + 'b0', 1.5); line([add(p[side].pedal, [-.065, 0, 0]), add(p[side].pedal, [.065, 0, 0])], colors[1], 2); }
    }
    if (mode === 3) {
      plane([[-.24, .62, -.45], [.24, .62, -.45], [.24, .62, .1], [-.24, .62, .1]], '#bcbcc425');
      plane([[-.24, .65, -.46], [.24, .65, -.46], [.24, 1.28, -.52], [-.24, 1.28, -.52]], '#bcbcc412');
      line([[0, .62, -.2], [0, .08, -.2], [0, .08, .2]], '#c5c5cf9a', 3);
      line([[-.38, .08, -.2], [.38, .08, -.2]], '#c5c5cf9a', 2);
      plane([[-.45, .18, .10], [-.45, .64, .10], [-.45, .64, .37], [-.45, .18, .37]], '#bcbcc419');
      ring([-.32, .72, .18], .12, 'yz', colors[0] + 'b0');
      line([[ -.45, .45, .2], [-.32, .72, .18], p[-1].knee, p[-1].ankle], colors[1] + 'b0', 2);
      line([add(p[-1].ankle, [-.08, .065, 0]), add(p[-1].ankle, [.08, .065, 0])], '#fff', 3);
    }
    if (mode === 4) {
      plane([[-.35, .42, -1.07], [.35, .42, -1.07], [.35, .42, .98], [-.35, .42, .98]], '#bcbcc41e', '#e2e2e98f');
      for (const z of [-.8, .72]) { line([[-.25, .41, z], [-.25, .05, z], [.25, .05, z], [.25, .41, z]], '#c9c9d46e', 2); }
      line([[-.43, .30, -1.08], [-.43, .30, .99]], '#c9c9d477', 2);
      const z = mix(-.98, .91, progress);
      line([[-.43, .32, z], [-.43, 1.02, z], [.41, 1.02, z], [.41, .88, z]], '#eeeeefb3', 2.5);
      plane([[-.4, 1.02, z - .07], [.4, 1.02, z - .07], [.4, 1.02, z + .07], [-.4, 1.02, z + .07]], colors[2] + '18', colors[2] + '80');
      ctx.setLineDash([2, 5]); line([[-.29, .99, z], [-.29, .44, z]], colors[2] + '70'); line([[.29, .99, z], [.29, .44, z]], colors[2] + '70'); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  // Model shapes follow measurement conventions, not a fitted clinical model:
  // gait: doi:10.7717/peerj.4640; running: doi:10.7717/peerj.3298;
  // exercise ECG: doi:10.3390/data2010001; DXA regions/units: CDC DXX_J codebook.
  // No downloaded recordings are used. Scroll advances a shared model clock;
  // the graphs show four seconds of that clock, not wall-clock acquisition.
  function cardiac(time, bpm) {
    const rr = 60 / bpm;
    const pulse = (center, width, amplitude) => {
      const distance = (fract((time - center) / rr + .5) - .5) * rr;
      return amplitude * Math.exp(-((distance / width) ** 2));
    };
    return pulse(-.14, .035, .12) - pulse(-.025, .009, .13)
      + pulse(0, .012, 1) - pulse(.026, .014, .30) + pulse(.19, .05, .24)
      + .012 * Math.sin(time * TAU * .25);
  }
  function groundForce(mode, phase) {
    const u = fract(phase), stance = mode === 0 ? .64 : .34;
    if (u >= stance) return 0; // No single-foot reaction force during swing.
    if (mode === 1) return Math.PI / (4 * stance) * Math.sin(Math.PI * u / stance);
    // Two walking load peaks; each foot supplies half a body-weight impulse.
    const load = gaitValue([[0,0],[.16,1.1],[.5,.78],[.84,1.1],[1,0]], u / stance);
    return load * .5 / (.64 * .8152);
  }
  function signalValue(mode, signal, time) {
    const model = signalModels[mode], phase = time / model.period;
    if (mode < 3 && signal === 0) return cardiac(time, model.bpm);
    if (mode < 2 && signal === 1) {
      // Proper vertical acceleration = 1 g + d²(hip height)/dt² / g.
      // Uses the same amplitude and phase offset as pose().
      const amplitude = mode === 0 ? .008 : -.035;
      const offset = mode === 0 ? 0 : .18;
      const omega = 2 * TAU / model.period;
      return 1 - amplitude * omega * omega * Math.cos((phase - offset) * TAU * 2) / 9.80665;
    }
    if (mode < 2) return groundForce(mode, phase);
    if (mode === 2) return signal === 1 ? fract(phase) * 360 : model.watts * (1 - .32 * Math.cos(phase * TAU * 2));
    const knee = kneeState(phase);
    return [knee.angle, knee.torque, knee.velocity][signal];
  }
  // Fixed, internally consistent example regions. Tissue mass does not change
  // during a scan: bars are revealed only when the scan passes the region.
  // BMD is BMC / projected bone area, not a T-score or diagnostic assessment.
  const dxaRegions = [
    { name: 'Head', end: .18, lean: 3.1, fat: 1.2, bmc: 450, area: 240 },
    { name: 'Arms', end: .58, lean: 4.8, fat: 1.6, bmc: 360, area: 480 },
    { name: 'Trunk', end: .58, lean: 25, fat: 8, bmc: 800, area: 850 },
    { name: 'Legs', end: .96, lean: 16, fat: 5, bmc: 1000, area: 870 },
  ];
  const signalCaptions = panels.map(panel => panel.querySelector('.signal-caption'));
  const axisLabels = panels.map(panel => {
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'signal-axis-label'); label.setAttribute('x', '1'); label.setAttribute('y', '63');
    panel.querySelector('svg').append(label);
    return label;
  });
  function signals(mode, progress) {
    const time = mode < 4 ? motionPhase(progress) * signalModels[mode].period : 0;
    traces.forEach((trace, signal) => {
      let path = '';
      if (mode === 4) {
        const limits = [30, 10, 2.2];
        dxaRegions.forEach((region, i) => {
          if (progress < region.end) return;
          const value = [region.lean, region.fat, region.bmc / region.area][signal];
          const x = i * 54 + 10, top = 49 - value / limits[signal] * 43;
          path += `M${x},49V${top.toFixed(2)}H${x + 22}V49`;
        });
        signalCaptions[signal].textContent = ['LEAN · kg', 'FAT · kg', 'BMD · g/cm²'][signal];
      } else {
        const [min, max] = signalModels[mode].ranges[signal];
        let previous;
        // Dense sampling keeps the narrow QRS peak visible at mobile widths.
        for (let sample = 0; sample <= 512; sample++) {
          const x = sample / 512 * 218 + 1;
          const value = signalValue(mode, signal, time - 4 + sample / 512 * 4);
          const y = 49 - clamp((value - min) / (max - min)) * 43;
          const wrap = mode === 2 && signal === 1 && previous !== undefined && value < previous - 180;
          path += `${sample && !wrap ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
          previous = value;
        }
        const value = signalValue(mode, signal, time);
        signalCaptions[signal].textContent = mode < 3 && signal === 0 ? `ECG · ${signalModels[mode].bpm} bpm`
          : mode < 2 ? (signal === 1 ? `${value.toFixed(2)} g · VERTICAL` : `${value.toFixed(2)} BW · LEFT`)
          : mode === 2 ? (signal === 1 ? `${Math.round(value)}° · 75 rpm` : `${Math.round(value)} W`)
          : signal === 0 ? `${Math.round(value)}° · FLEXION`
          : signal === 1 ? `${Math.round(value)} N·m` : `${Math.round(value)}°/s`;
      }
      trace.setAttribute('d', path);
    });
  }

  function updateLabels(mode) {
    if (active === mode) return;
    active = mode;
    const info = sceneInfo[mode];
    chapters.forEach((chapter, i) => { chapter.classList.toggle('is-active', i === mode); chapter.setAttribute('aria-hidden', String(i !== mode)); chapter.inert = i !== mode; });
    links.forEach((link, i) => { if (i === mode) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current'); });
    study.querySelector('[data-scene-label]').textContent = info.name;
    study.querySelector('[data-scene-number]').textContent = `FIG. 0${mode + 1} / 05`;
    stage.setAttribute('aria-label', info.description + ' Illustration only, not recorded research data.');
    stage.dataset.scene = chapters[mode].dataset.chapter;
    panels.forEach((panel, i) => {
      panel.style.setProperty('--signal-color', signalPalettes[mode][i]);
      panel.querySelector('.signal-title').textContent = info.signals[i][0];
      panel.querySelector('.signal-caption').textContent = info.signals[i][1];
      axisLabels[i].replaceChildren();
      const ticks = mode === 4 ? dxaRegions.map((region, j) => [21 + j * 54, region.name, 'middle'])
        : [[1, '−4 s', 'start'], [219, '0 s', 'end']];
      ticks.forEach(([x, text, anchor]) => {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tick.setAttribute('x', x); tick.setAttribute('text-anchor', anchor); tick.textContent = text;
        axisLabels[i].append(tick);
      });
    });
  }

  function render() {
    const mode = Math.min(4, Math.floor(current));
    const rawProgress = clamp(current - mode);
    const progress = rawProgress;
    const blend = mode === 4 ? 0 : smooth((rawProgress - .82) / .18);
    const next = Math.min(4, mode + 1);
    const a = pose(mode, progress), b = pose(next, 0);
    const p = blend ? blendPose(a, b, blend) : a;
    updateLabels(mode);
    const yaw = [1.02, 1.1, 1.08, 1.06, 1.1];
    const floor = mix(mode === 4 ? .75 : .88, next === 4 ? .75 : .88, blend);
    camera = { yaw: mix(yaw[mode], yaw[next], blend) + .09 * Math.sin(progress * Math.PI), unit: Math.min(height * .44, width * .34), center: width * .345, floor: height * floor };
    ctx.clearRect(0, 0, width, height);
    ground();
    if (mode < 2) footContact(mode, progress, p, 1 - blend);
    equipment(mode, progress, a, 1 - blend);
    if (blend) equipment(next, 0, b, blend);
    const view = [-Math.sin(camera.yaw), .18, Math.cos(camera.yaw)];
    const points = bodyPoints(p, mode).map(v => ({ ...project(v.p), size: v.size, light: dot(v.normal, [-.35, .5, .78]), facing: dot(v.normal, view) }));
    points.sort((x, y) => x.depth - y.depth);
    for (const point of points) {
      const light = clamp(.56 + point.light * .38 + point.facing * .14);
      const shade = Math.round(125 + light * 125);
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${point.facing > -.12 ? .88 : .27})`;
      ctx.beginPath(); ctx.arc(point.x, point.y, point.size * (height / 550), 0, TAU); ctx.fill();
    }
    if (mode === 4) {
      const z = mix(-.98, .91, progress);
      plane([[-.31, .66, z - .025], [.31, .66, z - .025], [.31, .66, z + .025], [-.31, .66, z + .025]], signalPalettes[mode][2] + '28', signalPalettes[mode][2] + 'cc');
    }
    const sources = mode === 2 ? [p.chest, p[-1].pedal, [0, .35, .37]]
      : mode === 3 ? [p[-1].knee, p[-1].ankle, p[-1].knee]
      : mode === 4 ? [p.chest, p.hip, p[-1].knee]
      : [p.chest, p.hip, p[-1].ankle];
    sources.forEach((source, i) => {
      if (!destinations[i]) return;
      const q = project(source), end = destinations[i];
      ctx.globalAlpha = 1 - blend * .7;
      const color = signalPalettes[mode][i];
      ctx.strokeStyle = color + '70'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(q.x, q.y); const elbow = Math.max(q.x + 16, mix(q.x, end.x, .45));
      ctx.lineTo(elbow, q.y); ctx.lineTo(Math.min(elbow + 20, end.x), end.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      ctx.strokeStyle = color + 'a0'; ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, TAU); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    });
    signals(mode, progress);
    story.querySelector('.story-progress > span').style.width = `${clamp(current / 4.999) * 100}%`;
  }

  function tick() {
    frame = 0;
    if (!visible || document.hidden) return;
    if (shortScreen.matches) current = target;
    else current += (target - current) * .18;
    if (Math.abs(current - target) < .0004) current = target;
    render();
    if (current !== target) frame = requestAnimationFrame(tick);
  }
  function requestRender() { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick); }
  function measure() {
    headerHeight = document.querySelector('.site-header').getBoundingClientRect().height;
    const rect = story.getBoundingClientRect();
    geometryTop = rect.top + scrollY - headerHeight;
    geometryRange = Math.max(1, rect.height - (innerHeight - headerHeight));
    const bounds = stage.getBoundingClientRect();
    const scale = bounds.width / 700;
    width = 700; height = bounds.height / scale;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * dpr); canvas.height = Math.round(bounds.height * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    destinations = panels.map(panel => ({ x: panel.parentElement.offsetLeft / scale, y: (panel.parentElement.offsetTop + panel.offsetTop + 19) / scale }));
    onScroll(); render();
  }
  function onScroll() {
    if (!shortScreen.matches) target = clamp((scrollY - geometryTop) / geometryRange) * 4.999;
    requestRender();
  }
  function selectScene(index, updateHistory = true) {
    const value = index + .20;
    if (shortScreen.matches) { target = value; requestRender(); }
    else window.scrollTo({ top: geometryTop + value / 4.999 * geometryRange, behavior: 'auto' });
    if (updateHistory) history.replaceState(null, '', links[index].getAttribute('href'));
  }
  links.forEach((link, index) => link.addEventListener('click', event => { event.preventDefault(); selectScene(index); }));
  shortScreen.addEventListener('change', measure);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);
  document.addEventListener('visibilitychange', () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; } else requestRender(); });
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) { current = target; requestRender(); } else if (frame) { cancelAnimationFrame(frame); frame = 0; } }).observe(study);
  new ResizeObserver(measure).observe(stage);
  story.classList.add('is-enhanced'); study.classList.add('is-ready');
  measure();
  const hashIndex = links.findIndex(link => link.getAttribute('href') === location.hash);
  if (hashIndex >= 0) requestAnimationFrame(() => selectScene(hashIndex, false));
})();
