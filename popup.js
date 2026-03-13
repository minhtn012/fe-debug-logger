(function () {
  const toggleBtn = document.getElementById('toggleBtn');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusEl = document.getElementById('status');
  const entryCountEl = document.getElementById('entryCount');
  const optConsole = document.getElementById('optConsole');
  const optUserActions = document.getElementById('optUserActions');
  const optNetwork = document.getElementById('optNetwork');
  const optComponentState = document.getElementById('optComponentState');

  let isRecording = false;

  function updateUI(recording, count) {
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
      exportBtn.disabled = count === 0;
      clearBtn.disabled = count === 0;
      setCheckboxesDisabled(false);
    }
    entryCountEl.textContent = count > 0 ? `${count} event${count !== 1 ? 's' : ''} captured` : '';
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
    if (resp) updateUI(resp.recording, resp.entryCount);
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

  exportBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'EXPORT_LOG' });
  });

  clearBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_LOG' }, () => {
      updateUI(false, 0);
    });
  });
})();
