(function () {
  const toggleBtn = document.getElementById('toggleBtn');
  const copyBtn = document.getElementById('copyBtn');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');
  const annotateBtn = document.getElementById('annotateBtn');
  const screenshotBtn = document.getElementById('screenshotBtn');
  const screenshotMenu = document.getElementById('screenshotMenu');
  const ssFullPage = document.getElementById('ssFullPage');
  const ssRegion = document.getElementById('ssRegion');
  const statusEl = document.getElementById('status');
  const entryCountEl = document.getElementById('entryCount');
  const annotationCountEl = document.getElementById('annotationCount');
  const optConsole = document.getElementById('optConsole');
  const optUserActions = document.getElementById('optUserActions');
  const optNetwork = document.getElementById('optNetwork');
  const optComponentState = document.getElementById('optComponentState');

  let isRecording = false;

  function updateUI(recording, count, annotCount) {
    isRecording = recording;
    if (recording) {
      statusEl.textContent = 'Recording...';
      statusEl.className = 'status recording';
      toggleBtn.textContent = 'Stop';
      toggleBtn.classList.add('active');
      exportBtn.disabled = true;
      clearBtn.disabled = true;
      setCheckboxesDisabled(true);
    } else {
      statusEl.textContent = 'Idle';
      statusEl.className = 'status idle';
      toggleBtn.textContent = 'Start';
      toggleBtn.classList.remove('active');
      const hasData = count > 0 || (annotCount || 0) > 0;
      copyBtn.disabled = !hasData;
      exportBtn.disabled = !hasData;
      clearBtn.disabled = !hasData;
      setCheckboxesDisabled(false);
    }
    entryCountEl.textContent = count > 0 ? `${count} event${count !== 1 ? 's' : ''} captured` : '';
    annotationCountEl.textContent = (annotCount || 0) > 0
      ? `${annotCount} annotation${annotCount !== 1 ? 's' : ''}`
      : '';
  }

  function setCheckboxesDisabled(disabled) {
    optConsole.disabled = disabled;
    optUserActions.disabled = disabled;
    optNetwork.disabled = disabled;
    optComponentState.disabled = disabled;
  }

  function getConfig() {
    return {
      console: optConsole.checked,
      userActions: optUserActions.checked,
      network: optNetwork.checked,
      componentState: optComponentState.checked,
    };
  }

  // Query current status on popup open
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (resp) => {
    if (resp) updateUI(resp.recording, resp.entryCount, resp.annotationCount);
  });

  toggleBtn.addEventListener('click', () => {
    if (isRecording) {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (resp) => {
        if (resp) updateUI(false, resp.entryCount);
      });
    } else {
      chrome.runtime.sendMessage({ type: 'START_RECORDING', config: getConfig() }, (resp) => {
        if (resp) updateUI(true, 0);
      });
    }
  });

  copyBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'COPY_LOG' });
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
      copyBtn.classList.remove('copied');
    }, 1500);
  });

  exportBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'EXPORT_LOG' });
  });

  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_LOG' }, () => {
      updateUI(false, 0, 0);
    });
  });

  // Annotate button — activates inspect mode
  annotateBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_ANNOTATE' }, () => {
      window.close();
    });
  });

  // Screenshot dropdown toggle
  screenshotBtn.addEventListener('click', () => {
    screenshotMenu.classList.toggle('hidden');
  });

  ssFullPage.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_FULL_PAGE' });
    window.close();
  });

  ssRegion.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_REGION_SELECT' });
    window.close();
  });
})();
