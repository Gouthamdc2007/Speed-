/**
 * SpeedPulse Speedometer Gauge & Live Waveform Canvas Visualizer
 */

class SpeedGaugeVisualizer {
  constructor() {
    this.progressCircle = document.getElementById('gaugeProgress');
    this.ticksGroup = document.getElementById('gaugeTicks');
    this.speedValueEl = document.getElementById('speedValue');
    this.speedUnitEl = document.getElementById('speedUnit');
    this.peakBadge = document.getElementById('peakBadge');
    this.peakValueEl = document.getElementById('peakValue');
    this.testLabelEl = document.getElementById('currentTestLabel');
    this.chartCanvas = document.getElementById('liveChart');
    this.chartStatEl = document.getElementById('chartStat');

    // Gauge geometry constants
    this.TOTAL_DASH = 660; // 270 degrees arc length for r=140
    this.ticksScale = [0, 1, 5, 10, 50, 100, 250, 500, 1000];

    // Canvas & Waveform chart setup
    this.ctx = this.chartCanvas ? this.chartCanvas.getContext('2d') : null;
    this.waveformPoints = [];
    this.maxPoints = 50;
    this.chartMaxSpeed = 10; // Dynamic scale

    this.currentTheme = 'download'; // 'download' or 'upload'

    this.initTicks();
    this.initCanvas();
  }

  /**
   * Logarithmic/Power scale mapping for realistic speedometer visualization.
   * Maps 0 -> 1000+ Mbps to 0 -> 1.0 (0% -> 100% arc fill)
   */
  speedToProgress(speed) {
    if (speed <= 0) return 0;
    if (speed >= 1000) return 1.0;
    // Logarithmic curve: progress = log(speed + 1) / log(1001)
    const normalized = Math.log10(speed + 1) / Math.log10(1001);
    return Math.min(1.0, Math.max(0, normalized));
  }

  initTicks() {
    if (!this.ticksGroup) return;
    this.ticksGroup.innerHTML = '';

    const cx = 180;
    const cy = 180;
    const radius = 140;
    const startAngle = 135; // degrees
    const totalAngle = 270; // degrees

    this.ticksScale.forEach((val) => {
      const progress = this.speedToProgress(val);
      const angleDeg = startAngle + progress * totalAngle;
      const angleRad = (angleDeg * Math.PI) / 180;

      // Inner tick start and end
      const rInner = radius - 12;
      const rOuter = radius + 2;
      const x1 = cx + rInner * Math.cos(angleRad);
      const y1 = cy + rInner * Math.sin(angleRad);
      const x2 = cx + rOuter * Math.cos(angleRad);
      const y2 = cy + rOuter * Math.sin(angleRad);

      // Label coordinate
      const rLabel = radius - 26;
      const lx = cx + rLabel * Math.cos(angleRad);
      const ly = cy + rLabel * Math.sin(angleRad) + 4; // slight vertical optical center

      // SVG Line Tick
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);

      // SVG Text Label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', lx);
      text.setAttribute('y', ly);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = val >= 1000 ? '1G' : val;

      this.ticksGroup.appendChild(line);
      this.ticksGroup.appendChild(text);
    });
  }

  setTheme(type) {
    this.currentTheme = type;
    if (this.progressCircle) {
      if (type === 'upload') {
        this.progressCircle.setAttribute('stroke', 'url(#gaugeGradientUpload)');
        this.progressCircle.style.filter = 'drop-shadow(0 0 12px rgba(244, 63, 94, 0.6))';
      } else {
        this.progressCircle.setAttribute('stroke', 'url(#gaugeGradient)');
        this.progressCircle.style.filter = 'drop-shadow(0 0 12px rgba(0, 242, 254, 0.6))';
      }
    }
  }

  update(speed, peakSpeed = 0, label = 'BANDWIDTH', unit = 'Mbps') {
    const progress = this.speedToProgress(speed);
    // stroke-dashoffset: TOTAL_DASH -> 0 as progress goes 0 -> 1
    const offset = this.TOTAL_DASH - (progress * this.TOTAL_DASH);

    if (this.progressCircle) {
      this.progressCircle.style.strokeDashoffset = offset;
    }

    if (this.speedValueEl) {
      this.speedValueEl.textContent = speed >= 100 ? speed.toFixed(0) : speed.toFixed(1);
    }

    if (this.speedUnitEl) {
      this.speedUnitEl.textContent = unit;
    }

    if (this.testLabelEl) {
      this.testLabelEl.textContent = label;
    }

    if (this.peakBadge && this.peakValueEl) {
      if (peakSpeed > 0) {
        this.peakBadge.style.opacity = '1';
        this.peakValueEl.textContent = peakSpeed >= 100 ? peakSpeed.toFixed(0) : peakSpeed.toFixed(1);
      } else {
        this.peakBadge.style.opacity = '0';
      }
    }

    // Update Waveform Canvas
    this.addWaveformPoint(speed);
  }

  reset() {
    if (this.progressCircle) {
      this.progressCircle.style.strokeDashoffset = this.TOTAL_DASH;
    }
    if (this.speedValueEl) {
      this.speedValueEl.textContent = '0.0';
    }
    if (this.peakBadge) {
      this.peakBadge.style.opacity = '0';
    }
    if (this.testLabelEl) {
      this.testLabelEl.textContent = 'BANDWIDTH';
    }
    this.clearWaveform();
  }

  /* ----------------- Waveform Canvas Chart ----------------- */

  initCanvas() {
    if (!this.chartCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.chartCanvas.getBoundingClientRect();
    
    // Set actual canvas resolution for crisp retina display
    this.chartCanvas.width = (rect.width || 600) * dpr;
    this.chartCanvas.height = 90 * dpr;
    if (this.ctx) {
      this.ctx.scale(dpr, dpr);
    }
    this.drawWaveform();
  }

  addWaveformPoint(val) {
    this.waveformPoints.push(val);
    if (this.waveformPoints.length > this.maxPoints) {
      this.waveformPoints.shift();
    }

    // Auto-adjust scale
    const currentMax = Math.max(...this.waveformPoints, 10);
    this.chartMaxSpeed = Math.max(this.chartMaxSpeed * 0.95, currentMax * 1.15);

    if (this.chartStatEl) {
      this.chartStatEl.textContent = `${val.toFixed(1)} Mbps`;
    }

    this.drawWaveform();
  }

  clearWaveform() {
    this.waveformPoints = [];
    this.chartMaxSpeed = 10;
    if (this.chartStatEl) {
      this.chartStatEl.textContent = `0.0 Mbps`;
    }
    this.drawWaveform();
  }

  drawWaveform() {
    if (!this.ctx || !this.chartCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = this.chartCanvas.width / dpr;
    const height = this.chartCanvas.height / dpr;

    this.ctx.clearRect(0, 0, width, height);

    // Draw Subtle Grid lines
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    this.ctx.lineWidth = 1;
    for (let y = 15; y < height; y += 25) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }

    if (this.waveformPoints.length < 2) return;

    const step = width / (this.maxPoints - 1);
    const startIndex = this.maxPoints - this.waveformPoints.length;

    // Draw Smooth Filled Curve
    this.ctx.beginPath();
    const firstX = startIndex * step;
    const firstY = height - (this.waveformPoints[0] / this.chartMaxSpeed) * (height - 15);
    this.ctx.moveTo(firstX, firstY);

    for (let i = 1; i < this.waveformPoints.length; i++) {
      const x = (startIndex + i) * step;
      const y = height - (this.waveformPoints[i] / this.chartMaxSpeed) * (height - 15);
      
      const prevX = (startIndex + i - 1) * step;
      const prevY = height - (this.waveformPoints[i - 1] / this.chartMaxSpeed) * (height - 15);
      const cpX = (prevX + x) / 2;
      
      this.ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
    }

    // Line Stroke Style
    this.ctx.strokeStyle = this.currentTheme === 'upload' ? '#f43f5e' : '#00f2fe';
    this.ctx.lineWidth = 2.5;
    this.ctx.shadowColor = this.currentTheme === 'upload' ? 'rgba(244, 63, 94, 0.6)' : 'rgba(0, 242, 254, 0.6)';
    this.ctx.shadowBlur = 10;
    this.ctx.stroke();
    this.ctx.shadowBlur = 0; // reset

    // Fill Gradient under curve
    const lastX = (startIndex + this.waveformPoints.length - 1) * step;
    this.ctx.lineTo(lastX, height);
    this.ctx.lineTo(firstX, height);
    this.ctx.closePath();

    const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
    if (this.currentTheme === 'upload') {
      gradient.addColorStop(0, 'rgba(244, 63, 94, 0.25)');
      gradient.addColorStop(1, 'rgba(244, 63, 94, 0.0)');
    } else {
      gradient.addColorStop(0, 'rgba(0, 242, 254, 0.25)');
      gradient.addColorStop(1, 'rgba(0, 242, 254, 0.0)');
    }

    this.ctx.fillStyle = gradient;
    this.ctx.fill();
  }
}

// Attach to window
window.SpeedGaugeVisualizer = SpeedGaugeVisualizer;
