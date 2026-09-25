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
  const feedbackBtn = document.getElementById('feedbackBtn');
  const feedbackStatusEl = document.getElementById('feedbackStatus');
  const feedbackReviewBtn = document.getElementById('feedbackReviewBtn');
  const annotateKeyEl = document.getElementById('annotateKey');

  let isRecording = false;

  function updateUI(recording, count, annotCount, shotCount) {
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
      const hasData = count > 0 || (annotCount || 0) > 0 || (shotCount || 0) > 0;
      copyBtn.disabled = !hasData;
      exportBtn.disabled = !hasData;
      clearBtn.disabled = !hasData;
      setCheckboxesDisabled(false);
    }
    entryCountEl.textContent = count > 0 ? `${count} event${count !== 1 ? 's' : ''} captured` : '';
    annotationCountEl.textContent = [
      annotCount > 0 ? `${annotCount} annotation${annotCount !== 1 ? 's' : ''}` : '',
      shotCount > 0 ? `${shotCount} screenshot${shotCount !== 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' · ');
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
    if (resp) updateUI(resp.recording, resp.entryCount, resp.annotationCount, resp.screenshotCount);
  });

  toggleBtn.addEventListener('click', () => {
    if (isRecording) {
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (resp) => {
        if (resp) updateUI(false, resp.entryCount, resp.annotationCount, resp.screenshotCount);
      });
    } else {
      chrome.runtime.sendMessage({ type: 'START_RECORDING', config: getConfig() }, (resp) => {
        if (resp?.error === 'feedback-active') {
          showFeedbackMessage('Có session feedback đang chạy, bấm Xong trên trang trước khi Record.', true);
        } else if (resp) {
          updateUI(true, 0);
        }
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

  // Feedback mode: toggle the floating button for the active tab's origin
  let feedbackOrigin = null;

  function showFeedbackMessage(text, isError) {
    feedbackStatusEl.textContent = text;
    feedbackStatusEl.classList.toggle('error', !!isError);
  }

  function renderFeedback(state) {
    const enabled = !!state?.siteEnabled;
    feedbackBtn.disabled = !feedbackOrigin;
    feedbackBtn.textContent = enabled ? 'Tắt Feedback' : 'Feedback';
    feedbackBtn.classList.toggle('active', enabled);
    if (!feedbackOrigin) showFeedbackMessage('Trang này không hỗ trợ feedback.');
    else if (!enabled) showFeedbackMessage('');
    else if (state.session) showFeedbackMessage(`Đang bật trên ${feedbackOrigin} · ${state.session.name}: ${state.session.itemCount} item`);
    else showFeedbackMessage(`Đang bật trên ${feedbackOrigin}`);
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      const url = new URL(tabs[0]?.url || '');
      if (url.protocol === 'http:' || url.protocol === 'https:') feedbackOrigin = url.origin;
    } catch (_) { /* no url: chrome:// or blank tab */ }
    if (!feedbackOrigin) return renderFeedback(null);
    chrome.runtime.sendMessage({ type: 'GET_FEEDBACK_STATUS', origin: feedbackOrigin }, renderFeedback);
  });

  feedbackBtn.addEventListener('click', () => {
    if (!feedbackOrigin) return;
    chrome.runtime.sendMessage({ type: 'TOGGLE_FEEDBACK_SITE', origin: feedbackOrigin }, (resp) => {
      if (resp?.error) showFeedbackMessage(`Lỗi: ${resp.error}`, true);
      else renderFeedback(resp);
    });
  });

  feedbackReviewBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_FEEDBACK_REVIEW' }, (resp) => {
      if (resp?.error) showFeedbackMessage(`Lỗi: ${resp.error}`, true);
      else window.close();
    });
  });

  // Shortcuts: show the keys Chrome actually assigned. The user may have changed
  // them, and Chrome leaves a key empty when it clashes with one already taken.
  chrome.commands.getAll((commands) => {
    for (const cmd of commands) {
      const key = cmd.shortcut || '';
      document.querySelectorAll(`kbd[data-cmd="${cmd.name}"]`).forEach((el) => {
        el.textContent = key || 'Chưa gán';
        el.classList.toggle('unset', !key);
      });
      if (cmd.name === 'toggle-annotate' && key) {
        annotateKeyEl.textContent = key;
        annotateKeyEl.hidden = false;
      }
    }
  });

  document.getElementById('shortcutsEditBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    window.close();
  });

  ssRegion.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'START_REGION_SELECT' });
    window.close();
  });
})();
