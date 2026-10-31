/* Horizon Sprint — vfx.js
 * Pooled skid marks + dust puffs. Zero per-frame allocation. */
(function () {
  window.G = window.G || {};
  var G = window.G;

  var SKIDS = 160;
  var DUST = 36;

  G.VFX = {
    skidMesh: null,
    skidCur: 0,
    skidN: 0,
    dust: [],
    dustTex: null,
    _dummy: null,

    init: function (scene) {
      this._dummy = new THREE.Object3D();
      var g = new THREE.PlaneGeometry(0.34, 1.15);
      g.rotateX(-Math.PI / 2);
      this.skidMesh = new THREE.InstancedMesh(
        g,
        new THREE.MeshBasicMaterial({
          color: 0x0a0a0a,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
        SKIDS,
      );
      this.skidMesh.count = 0;
      this.skidMesh.renderOrder = 2;
      this.skidMesh.frustumCulled = false;
      scene.add(this.skidMesh);

      var c = document.createElement("canvas");
      c.width = c.height = 64;
      var x = c.getContext("2d");
      var gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, "rgba(255,255,255,0.85)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
      this.dustTex = new THREE.CanvasTexture(c);
      for (var i = 0; i < DUST; i++) {
        var m = new THREE.SpriteMaterial({
          map: this.dustTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        var s = new THREE.Sprite(m);
        s.visible = false;
        scene.add(s);
        this.dust.push({ s: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 3 });
      }
      this._di = 0;
      this.initAmbient(scene);
    },

    amb: null,
    ambN: 260,
    ambOff: null,
    initAmbient: function (scene) {
      var g = new THREE.BufferGeometry();
      var p = new Float32Array(this.ambN * 3);
      this.ambOff = new Float32Array(this.ambN * 3);
      for (var i = 0; i < this.ambN; i++) {
        this.ambOff[i * 3] = (Math.random() - 0.5) * 240;
        this.ambOff[i * 3 + 1] = 0.5 + Math.random() * 22;
        this.ambOff[i * 3 + 2] = (Math.random() - 0.5) * 240;
      }
      g.setAttribute("position", new THREE.BufferAttribute(p, 3));
      this.amb = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          map: this.dustTex,
          size: 1.1,
          transparent: true,
          opacity: 0.28,
          color: 0xffdcb0,
          depthWrite: false,
          sizeAttenuation: true,
        }),
      );
      this.amb.frustumCulled = false;
      this.amb.renderOrder = 4;
      scene.add(this.amb);
    },
    setAmbient: function (on) {
      if (this.amb) this.amb.visible = !!on;
    },
    updateAmbient: function (time, px, pz) {
      if (!this.amb || !this.amb.visible) return;
      var attr = this.amb.geometry.attributes.position;
      var a = attr.array,
        o = this.ambOff;
      for (var i = 0; i < this.ambN; i++) {
        var ox = o[i * 3] + time * 1.5;
        ox = ((((ox + 120) % 240) + 240) % 240) - 120;
        a[i * 3] = px + ox;
        a[i * 3 + 1] = o[i * 3 + 1] + Math.sin(time * 0.5 + i * 1.7) * 1.6;
        a[i * 3 + 2] = pz + o[i * 3 + 2];
      }
      attr.needsUpdate = true;
    },

    dropSkid: function (x, z, angle) {
      var d = this._dummy;
      d.position.set(x, 0.012, z);
      d.rotation.set(0, angle, 0);
      d.updateMatrix();
      this.skidMesh.setMatrixAt(this.skidCur, d.matrix);
      this.skidCur = (this.skidCur + 1) % SKIDS;
      if (this.skidN < SKIDS) {
        this.skidN++;
        this.skidMesh.count = this.skidN;
      }
      this.skidMesh.instanceMatrix.needsUpdate = true;
    },

    puff: function (x, y, z, color, n, spread, up) {
      for (var k = 0; k < n; k++) {
        var p = this.dust[this._di];
        this._di = (this._di + 1) % DUST;
        p.s.visible = true;
        p.s.position.set(
          x + (Math.random() - 0.5) * spread,
          y,
          z + (Math.random() - 0.5) * spread,
        );
        p.s.material.color.setHex(color);
        p.s.material.opacity = 0.55;
        p.s.scale.set(1.4, 1.4, 1);
        p.max = 0.7 + Math.random() * 0.5;
        p.life = p.max;
        p.vx = (Math.random() - 0.5) * 3;
        p.vy = up + Math.random() * 2;
        p.vz = (Math.random() - 0.5) * 3;
        p.grow = 4 + Math.random() * 3;
      }
    },

    update: function (dt, time, px, pz) {
      this.updateAmbient(time || 0, px || 0, pz || 0);
      for (var i = 0; i < DUST; i++) {
        var p = this.dust[i];
        if (!p.s.visible) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.s.visible = false;
          continue;
        }
        var f = p.life / p.max;
        p.s.position.x += p.vx * dt;
        p.s.position.y += p.vy * dt;
        p.s.position.z += p.vz * dt;
        var sc = p.s.scale.x + p.grow * dt;
        p.s.scale.set(sc, sc, 1);
        p.s.material.opacity = 0.5 * f;
      }
    },

    reset: function () {
      this.skidCur = 0;
      this.skidN = 0;
      if (this.skidMesh) this.skidMesh.count = 0;
      for (var i = 0; i < this.dust.length; i++) this.dust[i].s.visible = false;
    },
  };
})();
