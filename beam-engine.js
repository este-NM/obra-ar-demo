(function(){
  const DATA=window.CHARGER_PATH;
  const P=DATA.points;
  const N=P.length;
  const M=DATA.markers;
  const TAU=Math.PI*2;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const wrap=s=>((s%1)+1)%1;
  const cdelta=(a,b)=>{ let d=wrap(b-a); if(d>0.5)d-=1; return d; };
  const arcProgress=(s,a,b)=>{
    s=wrap(s); a=wrap(a); b=wrap(b);
    const len=wrap(b-a); const pos=wrap(s-a);
    return pos<=len ? pos/Math.max(1e-6,len) : null;
  };
  const smoothstep=t=>{t=clamp(t,0,1); return t*t*(3-2*t);};

  function speedProfile(s){
    // A→B increase; B→C maximum; C→D decrease; D→E slight increase; E→A decrease to minimum.
    let q;
    if((q=arcProgress(s,M.A,M.B))!==null) return 0.62 + 0.55*smoothstep(q);
    if((q=arcProgress(s,M.B,M.C))!==null) return 1.20 + 0.18*Math.sin(Math.PI*q);
    if((q=arcProgress(s,M.C,M.D))!==null) return 1.05 - 0.45*smoothstep(q);
    if((q=arcProgress(s,M.D,M.E))!==null) return 0.62 + 0.18*smoothstep(q);
    if((q=arcProgress(s,M.E,M.A))!==null) return 0.72 - 0.38*smoothstep(q);
    return 0.7;
  }

  function occlusionFactor(s){
    let f=1;
    for(const z of DATA.downZones){
      const d=Math.abs(cdelta(z.s,s));
      if(d<z.half){
        const q=d/z.half;
        // almost fully hidden at center, smoothly recovers at the edges
        f=Math.min(f,0.06+0.94*smoothstep(q));
      }
    }
    return f;
  }

  class PathModel{
    constructor(){ this.points=P; this.N=N; }
    pointAt(s){
      s=wrap(s); const f=s*N; const i=Math.floor(f)%N; const j=(i+1)%N; const t=f-i;
      return [P[i][0]*(1-t)+P[j][0]*t, P[i][1]*(1-t)+P[j][1]*t];
    }
    nearest(nx,ny, referenceS=null){
      let best=-1, bestScore=1e9, bestD2=1e9;
      // Spatial distance dominates. When multiple branches overlap, continuity breaks the tie.
      for(let i=0;i<N;i++){
        const dx=P[i][0]-nx, dy=P[i][1]-ny;
        const d2=dx*dx+dy*dy;
        let score=d2;
        if(referenceS!==null){
          const ds=Math.abs(cdelta(referenceS,i/N));
          score += Math.max(0, ds-0.028)*0.010;
        }
        if(score<bestScore){ bestScore=score; best=i; bestD2=d2; }
      }
      return {s:best/N, dist:Math.sqrt(bestD2)};
    }
  }

  class BeamEngine{
    constructor(canvas, opts={}){
      this.canvas=canvas; this.ctx=canvas.getContext('2d');
      this.path=new PathModel();
      this.w=canvas.width; this.h=canvas.height;
      this.headS=null; this.targetS=null; this.lastT=null; this.lastInputTime=-999;
      this.direction=1; this.history=[]; this.propagations=[];
      this.channelReady=false; this.channelData=null; this.channelW=0; this.channelH=0;
      this.baseSpeed=opts.baseSpeed||0.28; // fraction of whole circuit per second at multiplier 1
      this.reacquireDelay=opts.reacquireDelay||0.9;
      this.active=false; this.pulsePhase=0;
    }
    async loadMask(src){
      const im=new Image(); im.src=src;
      await new Promise((res,rej)=>{im.onload=res; im.onerror=rej;});
      const c=document.createElement('canvas'); c.width=im.naturalWidth; c.height=im.naturalHeight;
      const x=c.getContext('2d'); x.drawImage(im,0,0);
      this.channelData=x.getImageData(0,0,c.width,c.height).data; this.channelW=c.width; this.channelH=c.height; this.channelReady=true;
    }
    inChannel(nx,ny){
      if(!this.channelReady) return true;
      if(nx<0||nx>1||ny<0||ny>1) return false;
      const x=clamp(Math.round(nx*(this.channelW-1)),0,this.channelW-1);
      const y=clamp(Math.round(ny*(this.channelH-1)),0,this.channelH-1);
      const i=(y*this.channelW+x)*4;
      return this.channelData[i]>105; // mask is grayscale
    }
    setCentrality(nx,ny,time){
      if(!this.inChannel(nx,ny)){ this.targetS=null; return false; }
      const ref=this.headS;
      const n=this.path.nearest(nx,ny,ref);
      // safety tolerance around exact vector channel; mask is primary selector
      if(n.dist>0.105){ this.targetS=null; return false; }
      if(this.headS===null || time-this.lastInputTime>this.reacquireDelay){
        this.headS=n.s; this.targetS=n.s; this.history=[];
      } else {
        // Don't teleport across a remote branch merely because the optical axis jumps.
        const ds=Math.abs(cdelta(this.headS,n.s));
        if(ds<0.17) this.targetS=n.s;
      }
      this.lastInputTime=time; this.active=true; return true;
    }
    clearCentrality(){ this.targetS=null; }
    tapAt(nx,ny,time){
      if(!this.inChannel(nx,ny)) return;
      const n=this.path.nearest(nx,ny,this.headS);
      if(n.dist<0.12){
        this.propagations.push({s:n.s,t0:time});
        if(this.propagations.length>8)this.propagations.shift();
      }
    }
    update(time){
      if(this.lastT===null)this.lastT=time;
      const dt=clamp(time-this.lastT,0,0.05); this.lastT=time;
      if(this.headS!==null && this.targetS!==null){
        const d=cdelta(this.headS,this.targetS);
        if(Math.abs(d)>0.00008){
          this.direction=d>=0?1:-1;
          const vmax=this.baseSpeed*speedProfile(this.headS)*dt;
          const step=Math.sign(d)*Math.min(Math.abs(d),vmax);
          this.headS=wrap(this.headS+step);
        }
        this.history.push({s:this.headS,t:time,dir:this.direction});
      }
      // medium persistence comet tail
      this.history=this.history.filter(h=>time-h.t<1.05);
      this.propagations=this.propagations.filter(p=>time-p.t0<2.15);
      if(time-this.lastInputTime>1.25 && this.history.length===0) this.active=false;
      this.render(time);
    }
    render(time){
      const ctx=this.ctx,w=this.w,h=this.h; ctx.clearRect(0,0,w,h);
      ctx.save(); ctx.globalCompositeOperation='lighter';
      // Comet tail follows actual centrality-driven motion.
      for(let pass=0;pass<3;pass++){
        const blur=pass===0?24:pass===1?10:0;
        ctx.shadowBlur=blur; ctx.shadowColor='rgba(220,245,255,0.95)';
        for(let i=0;i<this.history.length;i++){
          const q=this.history[i]; const age=time-q.t; const life=clamp(1-age/1.05,0,1);
          if(life<=0)continue;
          const pt=this.path.pointAt(q.s); const occ=occlusionFactor(q.s);
          const pulse=0.78+0.22*Math.sin(time*13-q.s*24);
          const alpha=life*occ*pulse*(pass===0?0.14:pass===1?0.24:0.66);
          const r=(pass===0?19:pass===1?9:3.4)*(0.72+0.55*life);
          const x=pt[0]*w,y=pt[1]*h;
          ctx.fillStyle=`rgba(235,249,255,${alpha})`;
          ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();
        }
      }
      // Leading head: titillating/pulsating core.
      if(this.headS!==null && this.history.length){
        const p=this.path.pointAt(this.headS), occ=occlusionFactor(this.headS);
        const pulse=0.72+0.28*Math.sin(time*11.5);
        const x=p[0]*w,y=p[1]*h;
        const g=ctx.createRadialGradient(x,y,0,x,y,34*(0.85+0.15*pulse));
        g.addColorStop(0,`rgba(255,255,255,${0.94*occ})`);
        g.addColorStop(.14,`rgba(220,250,255,${0.88*occ})`);
        g.addColorStop(.45,`rgba(140,225,255,${0.28*occ*pulse})`);
        g.addColorStop(1,'rgba(120,220,255,0)');
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,36,0,TAU);ctx.fill();
      }
      // Tap propagation: two fronts travel along the same supplied trajectory.
      for(const pr of this.propagations){
        const age=time-pr.t0; const life=clamp(1-age/2.15,0,1);
        const travel=0.33*age;
        for(const dir of [-1,1]){
          const front=wrap(pr.s+dir*travel);
          for(let k=0;k<24;k++){
            const ss=wrap(front-dir*k*0.0027);
            const pt=this.path.pointAt(ss); const occ=occlusionFactor(ss);
            const a=(1-k/24)*life*occ*0.52;
            ctx.shadowBlur=14;ctx.shadowColor='rgba(255,255,255,.9)';
            ctx.fillStyle=`rgba(255,245,220,${a})`;
            ctx.beginPath();ctx.arc(pt[0]*w,pt[1]*h,4.5*(1-k/28),0,TAU);ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }
  window.ChargerBeam={BeamEngine,PathModel,speedProfile,occlusionFactor,wrap,cdelta};
})();
