/**
 * SpeedPulse High-Precision Network Speed Test Engine
 * Handles multi-stream parallel chunk streaming for Latency, Download, and Upload.
 */

class SpeedTestEngine {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || '';
    this.concurrency = options.concurrency || 4;
    this.duration = options.duration || 10; // in seconds
    this.unit = options.unit || 'Mbps'; // 'Mbps', 'MBps', 'Gbps'
    
    this.abortController = null;
    this.isRunning = false;
  }

  setServerUrl(url) {
    this.serverUrl = url.replace(/\/+$/, '');
  }

  setOptions(options) {
    if (options.concurrency) this.concurrency = parseInt(options.concurrency);
    if (options.duration) this.duration = parseInt(options.duration);
    if (options.unit) this.unit = options.unit;
    if (options.serverUrl !== undefined) this.setServerUrl(options.serverUrl);
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
  }

  /**
   * 1. LATENCY & JITTER TEST
   * Sends multiple burst requests, calculates min, average, and jitter
   */
  async runPingTest(sampleCount = 12, onProgress) {
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const rtts = [];

    for (let i = 0; i < sampleCount; i++) {
      if (signal.aborted) break;

      const startTime = performance.now();
      try {
        const cacheBuster = `?t=${Date.now()}_${i}`;
        const res = await fetch(`${this.serverUrl}/api/ping${cacheBuster}`, {
          signal,
          cache: 'no-store'
        });
        
        if (res.ok) {
          const endTime = performance.now();
          const rtt = endTime - startTime;
          rtts.push(rtt);

          if (onProgress) {
            onProgress({
              currentRtt: rtt,
              completedSamples: rtts.length,
              totalSamples: sampleCount
            });
          }
        }
      } catch (err) {
        if (signal.aborted) throw new Error('Test aborted');
        console.warn('Ping sample failed:', err);
      }

      // Small delay between pings to avoid burst queuing
      await new Promise(r => setTimeout(r, 60));
    }

    if (rtts.length === 0) {
      throw new Error('Ping test failed to reach server');
    }

    // Discard upper and lower outliers if enough samples
    let validRtts = [...rtts];
    if (validRtts.length >= 6) {
      validRtts.sort((a, b) => a - b);
      validRtts = validRtts.slice(1, validRtts.length - 1); // remove min & max
    }

    const minPing = Math.min(...validRtts);
    const avgPing = validRtts.reduce((a, b) => a + b, 0) / validRtts.length;

    // Calculate Jitter (Mean Deviation of successive differences)
    let jitterSum = 0;
    for (let i = 1; i < rtts.length; i++) {
      jitterSum += Math.abs(rtts[i] - rtts[i - 1]);
    }
    const jitter = rtts.length > 1 ? jitterSum / (rtts.length - 1) : 0;

    return {
      ping: parseFloat(avgPing.toFixed(1)),
      minPing: parseFloat(minPing.toFixed(1)),
      jitter: parseFloat(jitter.toFixed(1)),
      samples: rtts.length
    };
  }

  /**
   * 2. DOWNLOAD SPEED TEST
   * Uses multi-stream concurrent chunk readers with sliding time window calculations
   */
  async runDownloadTest(onProgress) {
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const testDurationMs = this.duration * 1000;
    const testStartTime = performance.now();

    let totalBytesTransferred = 0;
    let peakSpeedMbps = 0;
    const speedSamples = [];

    // Rolling byte counter for accurate sliding window
    const windowSizeMs = 600;
    let windowBytes = 0;
    let windowStartTime = performance.now();

    const workerStream = async (streamIndex) => {
      while (!signal.aborted && (performance.now() - testStartTime < testDurationMs)) {
        try {
          const cacheBuster = `?size=35&_=${Date.now()}_${streamIndex}_${Math.random()}`;
          const res = await fetch(`${this.serverUrl}/api/download${cacheBuster}`, {
            signal,
            cache: 'no-store'
          });

          if (!res.ok || !res.body) break;

          const reader = res.body.getReader();
          while (!signal.aborted && (performance.now() - testStartTime < testDurationMs)) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              const chunkLen = value.length;
              totalBytesTransferred += chunkLen;
              windowBytes += chunkLen;
            }
          }
        } catch (err) {
          if (signal.aborted) break;
          // Re-attempt loop until time expires
          await new Promise(r => setTimeout(r, 50));
        }
      }
    };

    // Sampling interval for UI update and calculations
    const progressInterval = setInterval(() => {
      const now = performance.now();
      const elapsedOverallSec = (now - testStartTime) / 1000;
      const windowElapsedSec = (now - windowStartTime) / 1000;

      if (windowElapsedSec >= 0.2) {
        // Calculate instantaneous throughput: (bytes * 8) / (seconds * 1,000,000) = Mbps
        const instantMbps = (windowBytes * 8) / (windowElapsedSec * 1000000);
        
        // Reset sliding window
        windowBytes = 0;
        windowStartTime = now;

        if (instantMbps > peakSpeedMbps && elapsedOverallSec > 0.5) {
          peakSpeedMbps = instantMbps;
        }

        // Add to historical samples (ignoring initial warmup spike)
        if (elapsedOverallSec > 0.6) {
          speedSamples.push(instantMbps);
        }

        const progressPercent = Math.min(100, (elapsedOverallSec / this.duration) * 100);

        if (onProgress) {
          onProgress({
            currentSpeed: instantMbps,
            peakSpeed: peakSpeedMbps,
            bytesTransferred: totalBytesTransferred,
            elapsedSec: elapsedOverallSec,
            progress: progressPercent
          });
        }
      }
    }, 100);

    // Launch parallel streams
    const streamPromises = [];
    for (let i = 0; i < this.concurrency; i++) {
      streamPromises.push(workerStream(i));
    }

    // Wait until time expires or all streams finish
    await Promise.race([
      Promise.all(streamPromises),
      new Promise(resolve => setTimeout(resolve, testDurationMs + 200))
    ]);

    // Clean up
    clearInterval(progressInterval);
    this.abort();

    // Compute average speed (using 80th percentile / stable trimmed mean)
    let avgSpeedMbps = 0;
    if (speedSamples.length > 0) {
      // Remove lowest and highest 10%
      const sorted = [...speedSamples].sort((a, b) => a - b);
      const startIdx = Math.floor(sorted.length * 0.1);
      const endIdx = Math.ceil(sorted.length * 0.9);
      const cleanSamples = sorted.slice(startIdx, endIdx);
      avgSpeedMbps = cleanSamples.reduce((a, b) => a + b, 0) / cleanSamples.length;
    } else {
      const overallSec = (performance.now() - testStartTime) / 1000;
      avgSpeedMbps = (totalBytesTransferred * 8) / (overallSec * 1000000);
    }

    return {
      speed: parseFloat(avgSpeedMbps.toFixed(2)),
      peakSpeed: parseFloat(peakSpeedMbps.toFixed(2)),
      totalBytes: totalBytesTransferred
    };
  }

  /**
   * 3. UPLOAD SPEED TEST
   * Generates binary payload buffers and pushes parallel multi-stream uploads with progress events
   */
  async runUploadTest(onProgress) {
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const testDurationMs = this.duration * 1000;
    const testStartTime = performance.now();

    let totalBytesUploaded = 0;
    let peakSpeedMbps = 0;
    const speedSamples = [];

    // Pre-generate a 2MB pseudo-random binary payload for uploads
    const payloadSize = 2 * 1024 * 1024; // 2MB chunk
    const uploadBuffer = new Uint8Array(payloadSize);
    for (let i = 0; i < payloadSize; i += 65536) {
      const sliceSize = Math.min(65536, payloadSize - i);
      crypto.getRandomValues(new Uint8Array(uploadBuffer.buffer, i, sliceSize));
    }
    const uploadBlob = new Blob([uploadBuffer], { type: 'application/octet-stream' });

    let windowBytes = 0;
    let windowStartTime = performance.now();

    const uploadWorker = async (workerId) => {
      while (!signal.aborted && (performance.now() - testStartTime < testDurationMs)) {
        try {
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const url = `${this.serverUrl}/api/upload?_=${Date.now()}_${workerId}_${Math.random()}`;
            
            xhr.open('POST', url, true);
            
            let lastLoaded = 0;
            xhr.upload.onprogress = (e) => {
              if (signal.aborted || (performance.now() - testStartTime >= testDurationMs)) {
                xhr.abort();
                resolve();
                return;
              }
              const delta = e.loaded - lastLoaded;
              lastLoaded = e.loaded;
              totalBytesUploaded += delta;
              windowBytes += delta;
            };

            xhr.onload = () => resolve();
            xhr.onerror = () => resolve(); // continue next chunk
            xhr.onabort = () => resolve();

            if (signal.aborted) {
              resolve();
              return;
            }

            xhr.send(uploadBlob);
          });
        } catch (e) {
          if (signal.aborted) break;
          await new Promise(r => setTimeout(r, 50));
        }
      }
    };

    // Sampling interval
    const progressInterval = setInterval(() => {
      const now = performance.now();
      const elapsedOverallSec = (now - testStartTime) / 1000;
      const windowElapsedSec = (now - windowStartTime) / 1000;

      if (windowElapsedSec >= 0.2) {
        const instantMbps = (windowBytes * 8) / (windowElapsedSec * 1000000);
        windowBytes = 0;
        windowStartTime = now;

        if (instantMbps > peakSpeedMbps && elapsedOverallSec > 0.5) {
          peakSpeedMbps = instantMbps;
        }

        if (elapsedOverallSec > 0.6) {
          speedSamples.push(instantMbps);
        }

        const progressPercent = Math.min(100, (elapsedOverallSec / this.duration) * 100);

        if (onProgress) {
          onProgress({
            currentSpeed: instantMbps,
            peakSpeed: peakSpeedMbps,
            bytesTransferred: totalBytesUploaded,
            elapsedSec: elapsedOverallSec,
            progress: progressPercent
          });
        }
      }
    }, 100);

    // Launch parallel upload workers
    const uploadPromises = [];
    for (let i = 0; i < this.concurrency; i++) {
      uploadPromises.push(uploadWorker(i));
    }

    await Promise.race([
      Promise.all(uploadPromises),
      new Promise(resolve => setTimeout(resolve, testDurationMs + 200))
    ]);

    clearInterval(progressInterval);
    this.abort();

    let avgSpeedMbps = 0;
    if (speedSamples.length > 0) {
      const sorted = [...speedSamples].sort((a, b) => a - b);
      const startIdx = Math.floor(sorted.length * 0.1);
      const endIdx = Math.ceil(sorted.length * 0.9);
      const cleanSamples = sorted.slice(startIdx, endIdx);
      avgSpeedMbps = cleanSamples.reduce((a, b) => a + b, 0) / cleanSamples.length;
    } else {
      const overallSec = (performance.now() - testStartTime) / 1000;
      avgSpeedMbps = (totalBytesUploaded * 8) / (overallSec * 1000000);
    }

    return {
      speed: parseFloat(avgSpeedMbps.toFixed(2)),
      peakSpeed: parseFloat(peakSpeedMbps.toFixed(2)),
      totalBytes: totalBytesUploaded
    };
  }
}

// Attach to window object
window.SpeedTestEngine = SpeedTestEngine;
