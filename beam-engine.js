(function(){
  const DATA = window.CHARGER_PATH;
  const P = DATA.points;
  const N = P.length;
  const M = DATA.markers;
  const TAU = Math.PI * 2;

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const mix = (a,b,t)=>a*(1-t)+b*t;
  const wrap = s => ((s % 1) + 1) % 1;
  const cdelta = (a,b) => { let d = wrap(b-a); if (d > 0.5) d -= 1; return d; };
  const smoothstep = t => { t = clamp(t,0,1); return t*t*(3-2*t); };

  const arcProgress = (s,a,b) => {
    s = wrap(s); a = wrap(a); b = wrap(b);
    const len = wrap(b-a), pos = wrap(s-a);
    return pos <= len ? pos / Math.max(1e-6, len) : null;
  };

  function speedProfile(s){
    let q;
    if((q=arcProgress(s,M.A,M.B))!==null) return 0.62 + 0.55*smoothstep(q);
    if((q=arcProgress(s,M.B,M.C))!==null) return 1.20 + 0.18*Math.sin(Math.PI*q);
    if((q=arcProgress(s,M.C,M.D))!==null) return 1.05 - 0.45*smoothstep(q);
    if((q=arcProgress(s,M.D,M.E))!==null) return 0.62 + 0.18*smoothstep(q);
    if((q=arcProgress(s,M.E,M.A))!==null) return 0.72 - 0.38*smoothstep(q);
    return 0.7;
  }

  function occlusionFactor(s){
    let f = 1;
    for(const z of DATA.downZones || []){
      const d = Math.abs(cdelta(z.s, s));
      if(d < z.half){
        const q = d / z.half;
        f = Math.min(f, 0.03 + 0.97 * smoothstep(q));
      }
    }
    return f;
  }

  class PathModel{
    constructor(){ this.points = P; this.N = N; }
    pointAt(s){
      s = wrap(s);
      const f = s * this.N;
      const i = Math.floor(f) % this.N;
      const j = (i + 1) % this.N;
      const t = f - i;
      return [
        this.points[i][0] * (1-t) + this.points[j][0] * t,
        this.points[i][1] * (1-t) + this.points[j][1] * t,
      ];
    }
    tangentAt(s){
      const a = this.pointAt(wrap(s - 1/this.N * 1.4));
      const b = this.pointAt(wrap(s + 1/this.N * 1.4));
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const m = Math.hypot(dx, dy) || 1;
      return [dx/m, dy/m];
    }
    nearest(nx,ny,referenceS=null){
      let best = -1, bestScore = 1e9, bestD2 = 1e9;
      for(let i=0;i<this.N;i++){
        const dx = this.points[i][0] - nx, dy = this.points[i][1] - ny;
        const d2 = dx*dx + dy*dy;
        let score = d2;
        if(referenceS!==null){
          const ds = Math.abs(cdelta(referenceS, i/this.N));
          score += Math.max(0, ds - 0.045) * 0.006;
        }
        if(score < bestScore){ bestScore = score; best = i; bestD2 = d2; }
      }
      return { s: best/this.N, dist: Math.sqrt(bestD2) };
    }
  }

  class BeamEngine{
    constructor(canvas, opts={}){
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.path = new PathModel();
      this.w = canvas.width;
      this.h = canvas.height;

      this.headS = null;
      this.targetS = null;
      this.lastT = null;
      this.lastInputTime = -999;
      this.direction = 1;
      this.velS = 0;

      this.history = [];
      this.propagations = [];
      this.channelReady = false;
      this.channelData = null;
      this.channelW = 0;
      this.channelH = 0;

      this.veinsReady = false;
      this.veinsImage = null;
      this.veinBase = document.createElement('canvas');
      this.veinMask = document.createElement('canvas');
      this.veinLit = document.createElement('canvas');
      this.veinBaseCtx = this.veinBase.getContext('2d');
      this.veinMaskCtx = this.veinMask.getContext('2d');
      this.veinLitCtx = this.veinLit.getContext('2d');

      this.baseSpeed = opts.baseSpeed || 0.28;
      this.reacquireDelay = opts.reacquireDelay || 0.95;
      this.captureRadius = opts.captureRadius || 0.19;     // easier pickup
      this.releaseRadius = opts.releaseRadius || 0.255;   // easier retention
      this.inputHold = opts.inputHold || 0.42;            // grace period before dropping
      this.activity = 0;
      this.inputStrength = 0;
      this.lastGoodS = null;
    }

    _resizeVeinBuffers(){
      const w = this.w || this.canvas.width;
      const h = this.h || this.canvas.height;
      for(const c of [this.veinBase,this.veinMask,this.veinLit]){ c.width=w; c.height=h; }
      if(this.veinsImage){
        this.veinBaseCtx.clearRect(0,0,w,h);
        this.veinBaseCtx.drawImage(this.veinsImage,0,0,w,h);
      }
    }

    async _loadImage(src){
      const im = new Image();
      im.src = src;
      await new Promise((res,rej)=>{ im.onload=res; im.onerror=rej; });
      return im;
    }

    async loadMask(src){
      const im = await this._loadImage(src);
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(im,0,0);
      this.channelData = x.getImageData(0,0,c.width,c.height).data;
      this.channelW = c.width; this.channelH = c.height; this.channelReady = true;
      try{
        this.veinsImage = await this._loadImage('veins.png');
        this.veinsReady = true;
        this._resizeVeinBuffers();
      }catch(e){
        this.veinsReady = false;
        console.warn('veins.png not found; using fallback glow only.');
      }
    }

    inChannel(nx,ny){
      if(!this.channelReady) return true;
      if(nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;
      const x = clamp(Math.round(nx*(this.channelW-1)),0,this.channelW-1);
      const y = clamp(Math.round(ny*(this.channelH-1)),0,this.channelH-1);
      const i = (y*this.channelW + x) * 4;
      return this.channelData[i] > 105;
    }

    setCentrality(nx,ny,time){
      const inside = this.inChannel(nx,ny);
      const n = inside ? this.path.nearest(nx,ny,this.headS) : null;
      if(!inside || !n || n.dist > this.releaseRadius){
        // don't lose the coupling instantly; keep the last target alive briefly.
        return false;
      }

      const influence = smoothstep(1 - clamp(n.dist / this.captureRadius, 0, 1));
      const softInfluence = influence > 0 ? influence : 0.14;
      this.inputStrength = Math.max(this.inputStrength * 0.72, softInfluence);

      if(this.headS === null || time - this.lastInputTime > this.reacquireDelay){
        this.headS = n.s;
        this.targetS = n.s;
        this.history = [];
      } else {
        const ds = Math.abs(cdelta(this.headS, n.s));
        if(ds < 0.30){
          // softly blend rather than snapping, so the path clings better.
          const d = cdelta(this.headS, n.s);
          this.targetS = wrap(this.headS + d * 0.92);
        }
      }
      this.lastGoodS = n.s;
      this.lastInputTime = time;
      return true;
    }

    clearCentrality(){
      // soft release: hold the last target briefly instead of cutting.
      if(this.headS !== null){
        this.targetS = this.targetS ?? this.headS;
      }
      this.inputStrength *= 0.92;
    }

    tapAt(nx,ny,time){
      if(!this.inChannel(nx,ny)) return;
      const n = this.path.nearest(nx,ny,this.headS);
      if(n.dist < 0.18){
        this.propagations.push({ s:n.s, t0:time, seed:Math.random() });
        if(this.propagations.length > 8) this.propagations.shift();
      }
    }

    update(time){
      if(this.lastT === null) this.lastT = time;
      const dt = clamp(time - this.lastT, 0, 0.05);
      this.lastT = time;

      if(this.veinBase.width !== this.w || this.veinBase.height !== this.h) this._resizeVeinBuffers();

      const inputAge = time - this.lastInputTime;
      const hasInput = inputAge <= this.inputHold && this.targetS !== null;
      const activityTarget = hasInput ? (0.40 + 0.60 * this.inputStrength) : Math.min(0.18, this.activity);
      this.activity = mix(this.activity, activityTarget, hasInput ? 0.15 : 0.05);

      if(!hasInput && inputAge > this.inputHold){
        this.targetS = null;
        this.inputStrength *= 0.96;
      }

      if(this.headS !== null && (this.targetS !== null || this.lastGoodS !== null)){
        const aim = this.targetS ?? this.lastGoodS;
        const d = cdelta(this.headS, aim);
        if(Math.abs(d) > 0.00005){
          this.direction = d >= 0 ? 1 : -1;
          const localSpeed = this.baseSpeed * speedProfile(this.headS) * mix(0.76, 1.10, Math.max(this.inputStrength, 0.22));
          const vmax = localSpeed * dt;
          const step = Math.sign(d) * Math.min(Math.abs(d), vmax);
          this.headS = wrap(this.headS + step);
          this.velS = Math.abs(step) / Math.max(dt, 1e-5);
        } else {
          this.velS *= 0.90;
        }
        this.history.push({
          s: this.headS,
          t: time,
          energy: mix(0.56, 1.0, Math.max(this.inputStrength, 0.2)),
          speed: this.velS
        });
      } else {
        this.velS *= 0.92;
      }

      this.history = this.history.filter(h => time - h.t < 2.3);
      this.propagations = this.propagations.filter(p => time - p.t0 < 2.8);
      this.render(time);
    }

    drawSoftNode(ctx, x, y, rx, ry, angle, rgba, alpha){
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = rgba;
      ctx.beginPath();
      ctx.ellipse(0,0,rx,ry,0,0,TAU);
      ctx.fill();
      ctx.restore();
    }

    _veinPulseNode(ctx, x, y, angle, rx, ry, a){
      ctx.save();
      ctx.translate(x,y); ctx.rotate(angle);
      const g = ctx.createRadialGradient(0,0,0,0,0,Math.max(rx,ry));
      g.addColorStop(0, `rgba(255,255,255,${0.95*a})`);
      g.addColorStop(0.28, `rgba(255,255,255,${0.56*a})`);
      g.addColorStop(0.65, `rgba(255,255,255,${0.22*a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0,0,rx,ry,0,0,TAU);
      ctx.fill();
      ctx.restore();
    }

    _buildVeinIllumination(time){
      if(!this.veinsReady) return;
      const w=this.w,h=this.h;
      const m=this.veinMaskCtx;
      m.clearRect(0,0,w,h);
      m.save();
      m.globalCompositeOperation='lighter';

      // invisible activation field coupled to the vector, visible content comes from the artwork traces.
      for(const q of this.history){
        const age=time-q.t;
        const life=clamp(1-age/2.3,0,1);
        if(life<=0) continue;
        const [px,py]=this.path.pointAt(q.s);
        const [tx,ty]=this.path.tangentAt(q.s);
        const x=px*w,y=py*h,ang=Math.atan2(ty,tx);
        const occ=occlusionFactor(q.s);
        const stretch=clamp(0.88+q.speed*0.52,0.9,1.55);
        const a=life*q.energy*this.activity*occ;
        this._veinPulseNode(m, x, y, ang, 54*stretch*(0.72+0.28*life), 36*(0.72+0.26*life), 0.44*a);
      }

      if(this.headS!==null && this.history.length){
        const [px,py]=this.path.pointAt(this.headS);
        const [tx,ty]=this.path.tangentAt(this.headS);
        const len = Math.hypot(tx,ty) || 1;

// vector perpendicular al riel
const nx = -ty / len;
const ny =  tx / len;

// cantidad máxima de desplazamiento
const vibrationPx = 8.0;

// vibración irregular: varias frecuencias superpuestas
const vibration =
  vibrationPx * (
    0.60 * Math.sin(TAU * 7.3  * time + this.headS * 31.0) +
    0.28 * Math.sin(TAU * 11.1 * time + this.headS * 53.0) +
    0.12 * Math.sin(TAU * 16.7 * time + this.headS * 79.0)
  );

const x = px*w + nx*vibration;
const y = py*h + ny*vibration;

const ang = Math.atan2(ty,tx);
        const occ=occlusionFactor(this.headS);
        const pulse=0.86+0.14*Math.sin(time*8.4);
        const stretch=clamp(1.0+this.velS*0.55,1.0,1.7);
        this._veinPulseNode(m, x, y, ang, 76*stretch, 45*pulse, 0.62*occ*(0.76+0.24*this.activity));
      }

      // Click/tap propagation: now also vein-coupled instead of a separate generic overlay.
      for(const pr of this.propagations){
        const age = time - pr.t0;
        const life = clamp(1 - age/2.8, 0, 1);
        const travel = 0.34 * age;
        for(const dir of [-1,1]){
          const front = wrap(pr.s + dir * travel);
          for(let k=0; k<34; k++){
            const fall = 1 - k/34;
            const ss = wrap(front - dir * k * 0.0029);
            const [px,py] = this.path.pointAt(ss);
            const [tx,ty] = this.path.tangentAt(ss);
            const x = px*w, y = py*h;
            const ang = Math.atan2(ty, tx);
            const occ = occlusionFactor(ss);
            const frontWeight = k < 5 ? 1.0 : 0.58;
            const a = fall * life * occ * frontWeight * 0.75;
            const stretch = 1.15 + 0.25*fall;
            this._veinPulseNode(m, x, y, ang, (k<5?44:30)*stretch, (k<5?22:16), a);
          }
        }
      }

      m.restore();

      const l=this.veinLitCtx;
      l.clearRect(0,0,w,h);
      l.globalCompositeOperation='source-over';
      l.drawImage(this.veinBase,0,0,w,h);
      l.globalCompositeOperation='destination-in';
      l.drawImage(this.veinMask,0,0,w,h);
      l.globalCompositeOperation='source-over';
    }

    render(time){
      const ctx = this.ctx, w = this.w, h = this.h;
      ctx.clearRect(0,0,w,h);

      this._buildVeinIllumination(time);
      if(this.veinsReady){
        const flickerHz = 19.0;
        const flickerDepth = 0.7;
        
        const lfo = 0.5 + 0.5 * Math.sin(TAU * flickerHz * time);
        const flicker = mix(1.0 - flickerDepth, 1.0, lfo);
        ctx.save();
        ctx.globalCompositeOperation='screen';
        ctx.globalAlpha=0.70 * flicker;
        ctx.filter='blur(13px)';
        ctx.drawImage(this.veinLit,0,0,w,h);
        ctx.filter='blur(5px)';
        ctx.globalAlpha=0.60 * flicker;
        ctx.drawImage(this.veinLit,0,0,w,h);
        ctx.filter='none';
        ctx.globalAlpha=0.96 * flicker;
        ctx.drawImage(this.veinLit,0,0,w,h);
        ctx.restore();
      } else {
        ctx.save();ctx.globalCompositeOperation='screen';
        for(const q of this.history){
          const age=time-q.t,life=clamp(1-age/1.7,0,1);
          const [px,py]=this.path.pointAt(q.s),[tx,ty]=this.path.tangentAt(q.s);
          const occ=occlusionFactor(q.s);
          this.drawSoftNode(ctx,px*w,py*h,16,6,Math.atan2(ty,tx),'rgba(255,244,224,1)',life*occ*0.12);
        }
        ctx.restore();
      }
    }
  }

  window.ChargerBeam = { BeamEngine, PathModel, speedProfile, occlusionFactor, wrap, cdelta };
})();
