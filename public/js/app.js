/**
 * SpeedPulse Application State Controller & UI Coordinator
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const startBtn = document.getElementById('startBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const phaseSteps = document.querySelectorAll('.phase-step');
  
  // Metric card elements
  const valPing = document.getElementById('valPing');
  const valJitter = document.getElementById('valJitter');
  const valDownload = document.getElementById('valDownload');
  const valDownloadMax = document.getElementById('valDownloadMax');
  const valUpload = document.getElementById('valUpload');
  const valUploadMax = document.getElementById('valUploadMax');
  const valQuality = document.getElementById('valQuality');
  const valQualityGrade = document.getElementById('valQualityGrade');

  // Telemetry elements
  const infoIp = document.getElementById('infoIp');
  const infoIsp = document.getElementById('infoIsp');
  const infoServer = document.getElementById('infoServer');

  // Modals & Triggers
  const historyBtn = document.getElementById('historyBtn');
  const historyModal = document.getElementById('historyModal');
  const closeHistoryBtn = document.getElementById('closeHistoryBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const historyTableBody = document.getElementById('historyTableBody');

  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const settingConcurrency = document.getElementById('settingConcurrency');
  const settingDuration = document.getElementById('settingDuration');
  const settingUnit = document.getElementById('settingUnit');
  const settingCustomServer = document.getElementById('settingCustomServer');

  const shareBtn = document.getElementById('shareBtn');
  const shareModal = document.getElementById('shareModal');
  const closeShareBtn = document.getElementById('closeShareBtn');
  const copySummaryBtn = document.getElementById('copySummaryBtn');
  const toast = document.getElementById('toast');

  // Share Card elements
  const shareDownload = document.getElementById('shareDownload');
  const shareUpload = document.getElementById('shareUpload');
  const sharePing = document.getElementById('sharePing');
  const shareJitter = document.getElementById('shareJitter');
  const shareQuality = document.getElementById('shareQuality');
  const shareDate = document.getElementById('shareDate');

  // Initialize Engine and Visualizer
  const engine = new SpeedTestEngine();
  const visualizer = new SpeedGaugeVisualizer();

  let isTestRunning = false;
  let latestResult = null;

  // Load Settings from LocalStorage
  loadSettings();
  // Fetch Client IP & ISP Telemetry
  fetchClientTelemetry();
  // Render Past History Table
  renderHistoryTable();

  // Handle Resize for Canvas Crispness
  window.addEventListener('resize', () => {
    visualizer.initCanvas();
  });

  /* ----------------- Test Execution Flow ----------------- */

  startBtn.addEventListener('click', () => {
    if (isTestRunning) {
      // Abort test
      engine.abort();
      resetTestUI();
      showToast('Speed test cancelled');
    } else {
      startSpeedTest();
    }
  });

  async function startSpeedTest() {
    isTestRunning = true;
    startBtn.classList.add('running');
    startBtn.querySelector('.btn-text').textContent = 'STOP';
    statusBadge.className = 'status-badge testing';
    statusText.textContent = 'Initializing Test...';
    shareBtn.style.display = 'none';

    // Clear previous metrics
    resetMetricCards();
    visualizer.reset();

    const result = {
      timestamp: new Date().toISOString(),
      ping: 0,
      jitter: 0,
      download: 0,
      downloadMax: 0,
      upload: 0,
      uploadMax: 0,
      quality: '--',
      grade: '--'
    };

    try {
      // 1. PING & JITTER PHASE
      setPhaseActive('ping');
      statusText.textContent = 'Measuring Ping & Jitter...';
      document.getElementById('cardPing').classList.add('active-testing');

      const pingData = await engine.runPingTest(12, (prog) => {
        valPing.textContent = prog.currentRtt.toFixed(1);
        visualizer.update(0, 0, 'PING TEST', 'ms');
      });

      result.ping = pingData.ping;
      result.jitter = pingData.jitter;
      valPing.textContent = pingData.ping.toFixed(1);
      valJitter.textContent = pingData.jitter.toFixed(1);
      document.getElementById('cardPing').classList.remove('active-testing');
      setPhaseDone('ping');

      // 2. DOWNLOAD PHASE
      setPhaseActive('download');
      statusText.textContent = 'Testing Download Speed...';
      visualizer.setTheme('download');
      document.getElementById('cardDownload').classList.add('active-testing');

      const downloadData = await engine.runDownloadTest((prog) => {
        visualizer.update(prog.currentSpeed, prog.peakSpeed, 'DOWNLOAD', engine.unit);
        valDownload.textContent = prog.currentSpeed.toFixed(1);
        valDownloadMax.textContent = prog.peakSpeed.toFixed(1);
      });

      result.download = downloadData.speed;
      result.downloadMax = downloadData.peakSpeed;
      valDownload.textContent = downloadData.speed.toFixed(1);
      valDownloadMax.textContent = downloadData.peakSpeed.toFixed(1);
      document.getElementById('cardDownload').classList.remove('active-testing');
      setPhaseDone('download');

      // 3. UPLOAD PHASE
      setPhaseActive('upload');
      statusText.textContent = 'Testing Upload Speed...';
      visualizer.setTheme('upload');
      visualizer.clearWaveform();
      document.getElementById('cardUpload').classList.add('active-testing');

      const uploadData = await engine.runUploadTest((prog) => {
        visualizer.update(prog.currentSpeed, prog.peakSpeed, 'UPLOAD', engine.unit);
        valUpload.textContent = prog.currentSpeed.toFixed(1);
        valUploadMax.textContent = prog.peakSpeed.toFixed(1);
      });

      result.upload = uploadData.speed;
      result.uploadMax = uploadData.peakSpeed;
      valUpload.textContent = uploadData.speed.toFixed(1);
      valUploadMax.textContent = uploadData.peakSpeed.toFixed(1);
      document.getElementById('cardUpload').classList.remove('active-testing');
      setPhaseDone('upload');

      // 4. QUALITY & RATING CALCULATION
      const qualityScore = calculateQualityScore(result.ping, result.jitter, result.download, result.upload);
      result.quality = qualityScore.label;
      result.grade = qualityScore.grade;

      valQuality.textContent = result.quality;
      valQualityGrade.textContent = result.grade;

      // Finish Test
      statusBadge.className = 'status-badge completed';
      statusText.textContent = 'Test Completed Successfully';
      visualizer.setTheme('download');
      visualizer.update(result.download, result.downloadMax, 'DOWNLOAD', engine.unit);

      latestResult = result;
      saveResultToHistory(result);
      shareBtn.style.display = 'inline-flex';
      showToast('Speed test finished!');
    } catch (err) {
      if (err.message === 'Test aborted') {
        statusText.textContent = 'Test Aborted';
      } else {
        console.error('Speed test error:', err);
        statusBadge.className = 'status-badge';
        statusText.textContent = 'Error: ' + (err.message || 'Connection failed');
        showToast('Speed test encountered an error', true);
      }
    } finally {
      isTestRunning = false;
      startBtn.classList.remove('running');
      startBtn.querySelector('.btn-text').textContent = 'RETEST';
      document.querySelectorAll('.metric-card').forEach(c => c.classList.remove('active-testing'));
    }
  }

  function resetTestUI() {
    isTestRunning = false;
    startBtn.classList.remove('running');
    startBtn.querySelector('.btn-text').textContent = 'GO';
    statusBadge.className = 'status-badge ready';
    statusText.textContent = 'Ready to Test';
    phaseSteps.forEach(p => p.className = 'phase-step');
    phaseSteps[0].classList.add('active');
    visualizer.reset();
  }

  function resetMetricCards() {
    valPing.textContent = '--';
    valJitter.textContent = '--';
    valDownload.textContent = '--';
    valDownloadMax.textContent = '--';
    valUpload.textContent = '--';
    valUploadMax.textContent = '--';
    valQuality.textContent = '--';
    valQualityGrade.textContent = '--';
  }

  function setPhaseActive(phaseName) {
    phaseSteps.forEach(el => {
      if (el.dataset.phase === phaseName) {
        el.className = 'phase-step active';
      } else if (el.classList.contains('done')) {
        el.className = 'phase-step done';
      } else {
        el.className = 'phase-step';
      }
    });
  }

  function setPhaseDone(phaseName) {
    phaseSteps.forEach(el => {
      if (el.dataset.phase === phaseName) {
        el.className = 'phase-step done';
      }
    });
  }

  /**
   * Calculates connection quality grade based on standard network SLA tiers
   */
  function calculateQualityScore(ping, jitter, download, upload) {
    if (ping < 20 && jitter < 5 && download > 100 && upload > 20) {
      return { grade: 'A+', label: 'Ultra Fast (Gigabit / Fiber)' };
    } else if (ping < 40 && jitter < 10 && download > 40 && upload > 10) {
      return { grade: 'A', label: 'Excellent (Streaming & Gaming)' };
    } else if (ping < 75 && jitter < 20 && download > 15) {
      return { grade: 'B', label: 'Good (HD Video & Calls)' };
    } else if (ping < 150 && download > 5) {
      return { grade: 'C', label: 'Fair (Browsing)' };
    } else {
      return { grade: 'D', label: 'Poor / High Latency' };
    }
  }

  /* ----------------- Telemetry & IP ----------------- */

  async function fetchClientTelemetry() {
    try {
      const res = await fetch(`${engine.serverUrl}/api/ip-info`);
      if (res.ok) {
        const data = await res.json();
        infoIp.textContent = data.ip || 'Unknown';
        infoIsp.textContent = data.isp ? `${data.isp} (${data.city || data.country})` : 'Unknown ISP';
      }
    } catch (e) {
      infoIp.textContent = '127.0.0.1 (Localhost)';
      infoIsp.textContent = 'Local Network';
    }
  }

  /* ----------------- Settings Manager ----------------- */

  function loadSettings() {
    const saved = localStorage.getItem('speedpulse_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        settingConcurrency.value = parsed.concurrency || '4';
        settingDuration.value = parsed.duration || '10';
        settingUnit.value = parsed.unit || 'Mbps';
        settingCustomServer.value = parsed.serverUrl || '';
        engine.setOptions(parsed);
      } catch (e) {}
    }
  }

  saveSettingsBtn.addEventListener('click', () => {
    const settings = {
      concurrency: settingConcurrency.value,
      duration: settingDuration.value,
      unit: settingUnit.value,
      serverUrl: settingCustomServer.value.trim()
    };
    localStorage.setItem('speedpulse_settings', JSON.stringify(settings));
    engine.setOptions(settings);
    settingsModal.classList.remove('open');
    showToast('Settings saved successfully!');
    fetchClientTelemetry();
  });

  /* ----------------- History Manager ----------------- */

  function getHistory() {
    const data = localStorage.getItem('speedpulse_history');
    return data ? JSON.parse(data) : [];
  }

  function saveResultToHistory(res) {
    const history = getHistory();
    history.unshift(res);
    // Keep max 50 items
    if (history.length > 50) history.pop();
    localStorage.setItem('speedpulse_history', JSON.stringify(history));
    renderHistoryTable();
  }

  function renderHistoryTable() {
    const history = getHistory();
    if (!historyTableBody) return;

    if (history.length === 0) {
      historyTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-msg">No tests recorded yet. Run your first speed test!</td>
        </tr>
      `;
      return;
    }

    historyTableBody.innerHTML = history.map(item => {
      const date = new Date(item.timestamp);
      const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <tr>
          <td>${formattedDate}</td>
          <td><strong style="color: #00f2fe;">${item.download}</strong> Mbps</td>
          <td><strong style="color: #f43f5e;">${item.upload}</strong> Mbps</td>
          <td>${item.ping} ms</td>
          <td>${item.jitter} ms</td>
        </tr>
      `;
    }).join('');
  }

  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your speed test history?')) {
      localStorage.removeItem('speedpulse_history');
      renderHistoryTable();
      showToast('History cleared');
    }
  });

  exportCsvBtn.addEventListener('click', () => {
    const history = getHistory();
    if (history.length === 0) {
      alert('No history records to export');
      return;
    }
    const headers = ['Timestamp', 'Download_Mbps', 'DownloadMax_Mbps', 'Upload_Mbps', 'UploadMax_Mbps', 'Ping_ms', 'Jitter_ms', 'Quality'];
    const rows = history.map(h => [
      h.timestamp, h.download, h.downloadMax, h.upload, h.uploadMax, h.ping, h.jitter, `"${h.quality || ''}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `speedtest_history_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  /* ----------------- Share Manager ----------------- */

  shareBtn.addEventListener('click', () => {
    if (!latestResult) return;
    shareDownload.textContent = latestResult.download;
    shareUpload.textContent = latestResult.upload;
    sharePing.textContent = latestResult.ping;
    shareJitter.textContent = latestResult.jitter;
    shareQuality.textContent = `${latestResult.grade} (${latestResult.quality})`;
    shareDate.textContent = new Date(latestResult.timestamp).toLocaleString();
    shareModal.classList.add('open');
  });

  copySummaryBtn.addEventListener('click', () => {
    if (!latestResult) return;
    const summary = `⚡ SpeedPulse Network Test:\n📥 Download: ${latestResult.download} Mbps (Max: ${latestResult.downloadMax} Mbps)\n📤 Upload: ${latestResult.upload} Mbps (Max: ${latestResult.uploadMax} Mbps)\n⏱️ Latency: ${latestResult.ping} ms | Jitter: ${latestResult.jitter} ms\n🛡️ Quality: ${latestResult.grade} - ${latestResult.quality}\nTested on: ${new Date(latestResult.timestamp).toLocaleString()}`;
    navigator.clipboard.writeText(summary).then(() => {
      showToast('Summary copied to clipboard!');
    });
  });

  /* ----------------- Modal Open/Close Controls ----------------- */

  historyBtn.addEventListener('click', () => historyModal.classList.add('open'));
  closeHistoryBtn.addEventListener('click', () => historyModal.classList.remove('open'));

  settingsBtn.addEventListener('click', () => settingsModal.classList.add('open'));
  closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('open'));

  closeShareBtn.addEventListener('click', () => shareModal.classList.remove('open'));

  // Close modals on clicking outside backdrop
  [historyModal, settingsModal, shareModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
      }
    });
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }
});
