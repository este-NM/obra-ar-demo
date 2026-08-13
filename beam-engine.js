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
          score += Math.max(0, ds - 0.032) * 0.008;
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
      this.reacquireDelay = opts.reacquireDelay || 0.9;
      this.captureRadius = opts.captureRadius || 0.145;
      this.activity = 0;
      this.inputStrength = 0;
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

      // Optional actual-art trace texture. If present, this is what lights up.
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
      if(!this.inChannel(nx,ny)){
        this.targetS = null; this.inputStrength = 0; return false;
      }
      const n = this.path.nearest(nx,ny,this.headS);
      if(n.dist > this.captureRadius){
        this.targetS = null; this.inputStrength = 0; return false;
      }
      this.inputStrength = smoothstep(1 - n.dist / this.captureRadius);
      if(this.headS === null || time - this.lastInputTime > this.reacquireDelay){
        this.headS = n.s; this.targetS = n.s; this.history = [];
      } else {
        const ds = Math.abs(cdelta(this.headS, n.s));
        if(ds < 0.20) this.targetS = n.s;
      }
      this.lastInputTime = time;
      return true;
    }

    clearCentrality(){ this.targetS = null; this.inputStrength = 0; }

    tapAt(nx,ny,time){
      if(!this.inChannel(nx,ny)) return;
      const n = this.path.nearest(nx,ny,this.headS);
      if(n.dist < 0.15){
        this.propagations.push({ s:n.s, t0:time, seed:Math.random() });
        if(this.propagations.length > 8) this.propagations.shift();
      }
    }

    update(time){
      if(this.lastT === null) this.lastT = time;
      const dt = clamp(time - this.lastT, 0, 0.05);
      this.lastT = time;

      // keep offscreen buffers synchronized if host canvas is resized
      if(this.veinBase.width !== this.w || this.veinBase.height !== this.h) this._resizeVeinBuffers();

      const hasInput = this.targetS !== null;
      const activityTarget = hasInput ? (0.38 + 0.62 * this.inputStrength) : 0;
      this.activity = mix(this.activity, activityTarget, hasInput ? 0.15 : 0.07);

      if(this.headS !== null && this.targetS !== null){
        const d = cdelta(this.headS, this.targetS);
        if(Math.abs(d) > 0.00005){
          this.direction = d >= 0 ? 1 : -1;
          const localSpeed = this.baseSpeed * speedProfile(this.headS) * mix(0.78, 1.12, this.inputStrength);
          const vmax = localSpeed * dt;
          const step = Math.sign(d) * Math.min(Math.abs(d), vmax);
          this.headS = wrap(this.headS + step);
          this.velS = Math.abs(step) / Math.max(dt, 1e-5);
        } else {
          this.velS *= 0.86;
        }
        this.history.push({
          s: this.headS,
          t: time,
          energy: mix(0.6, 1.0, this.inputStrength),
          speed: this.velS
        });
      } else {
        this.velS *= 0.90;
      }

      this.history = this.history.filter(h => time - h.t < 1.55);
      this.propagations = this.propagations.filter(p => time - p.t0 < 2.5);
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

    _buildVeinIllumination(time){
      if(!this.veinsReady) return;
      const w=this.w,h=this.h;
      const m=this.veinMaskCtx;
      m.clearRect(0,0,w,h);
      m.save();
      m.globalCompositeOperation='lighter';

      // The vector only drives an invisible moving activation field.
      // The visible content comes from veins.png (actual artwork traces).
      for(const q of this.history){
        const age=time-q.t;
        const life=clamp(1-age/1.55,0,1);
        if(life<=0) continue;
        const [px,py]=this.path.pointAt(q.s);
        const [tx,ty]=this.path.tangentAt(q.s);
        const x=px*w,y=py*h,ang=Math.atan2(ty,tx);
        const occ=occlusionFactor(q.s);
        const stretch=clamp(0.85+q.speed*0.55,0.9,1.6);
        const a=life*q.energy*this.activity*occ;

        m.save();
        m.translate(x,y); m.rotate(ang);
        const rx=52*stretch*(0.72+0.32*life), ry=35*(0.72+0.28*life);
        const g=m.createRadialGradient(0,0,0,0,0,Math.max(rx,ry));
        g.addColorStop(0,`rgba(255,255,255,${0.52*a})`);
        g.addColorStop(0.45,`rgba(255,255,255,${0.30*a})`);
        g.addColorStop(1,'rgba(255,255,255,0)');
        m.fillStyle=g;
        m.beginPath();m.ellipse(0,0,rx,ry,0,0,TAU);m.fill();
        m.restore();
      }

      // current focus gets a slightly stronger, broader activation but still no visible geometric beam
      if(this.headS!==null && this.history.length){
        const [px,py]=this.path.pointAt(this.headS);
        const [tx,ty]=this.path.tangentAt(this.headS);
        const x=px*w,y=py*h,ang=Math.atan2(ty,tx);
        const occ=occlusionFactor(this.headS);
        const pulse=0.86+0.14*Math.sin(time*8.4);
        m.save();m.translate(x,y);m.rotate(ang);
        const rx=72*(0.95+0.18*clamp(this.velS,0,1.4)), ry=43*pulse;
        const g=m.createRadialGradient(0,0,0,0,0,Math.max(rx,ry));
        g.addColorStop(0,`rgba(255,255,255,${0.82*occ*(0.75+0.25*this.activity)})`);
        g.addColorStop(0.50,`rgba(255,255,255,${0.38*occ})`);
        g.addColorStop(1,'rgba(255,255,255,0)');
        m.fillStyle=g;m.beginPath();m.ellipse(0,0,rx,ry,0,0,TAU);m.fill();
        m.restore();
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

      // Main motion: illuminate actual artwork traces as vein-like networks.
      this._buildVeinIllumination(time);
      if(this.veinsReady){
        ctx.save();
        ctx.globalCompositeOperation='screen';
        ctx.globalAlpha=0.72;
        ctx.filter='blur(12px)';
        ctx.drawImage(this.veinLit,0,0,w,h);
        ctx.filter='blur(4px)';
        ctx.globalAlpha=0.58;
        ctx.drawImage(this.veinLit,0,0,w,h);
        ctx.filter='none';
        ctx.globalAlpha=0.92;
        ctx.drawImage(this.veinLit,0,0,w,h);
        ctx.restore();
      } else {
        // fallback only if veins.png wasn't uploaded
        ctx.save();ctx.globalCompositeOperation='screen';
        for(const q of this.history){
          const age=time-q.t,life=clamp(1-age/1.55,0,1);
          const [px,py]=this.path.pointAt(q.s),[tx,ty]=this.path.tangentAt(q.s);
          const occ=occlusionFactor(q.s);
          this.drawSoftNode(ctx,px*w,py*h,16,6,Math.atan2(ty,tx),'rgba(255,244,224,1)',life*occ*0.12);
        }
        ctx.restore();
      }

      // CLICK EFFECT — intentionally preserved from V3 unchanged.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for(const pr of this.propagations){
        const age = time - pr.t0;
        const life = clamp(1 - age/2.5, 0, 1);
        const travel = 0.35 * age;
        for(const dir of [-1,1]){
          const front = wrap(pr.s + dir * travel);
          for(let k=0; k<26; k++){
            const fall = 1 - k/26;
            const ss = wrap(front - dir * k * 0.003);
            const [px,py] = this.path.pointAt(ss);
            const [tx,ty] = this.path.tangentAt(ss);
            const x = px*w, y = py*h;
            const ang = Math.atan2(ty, tx);
            const occ = occlusionFactor(ss);
            const alpha = fall * life * occ * (k < 4 ? 0.22 : 0.11);
            const rx = (k < 4 ? 11 : 7) * (1 + 0.35*fall);
            const ry = (k < 4 ? 4.2 : 3.4);
            this.drawSoftNode(ctx, x, y, rx, ry, ang, k < 4 ? 'rgba(255,250,235,1)' : 'rgba(255,236,208,1)', alpha);
          }
        }
      }
      ctx.restore();
    }
  }

  window.ChargerBeam = { BeamEngine, PathModel, speedProfile, occlusionFactor, wrap, cdelta };
})();
