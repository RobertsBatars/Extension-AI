let globalScreenshot = null;

document.addEventListener('DOMContentLoaded', function() {
  const apiKeyInput = document.getElementById('apiKey');
  const analyzeButton = document.getElementById('analyzeButton');
  const statusDiv = document.getElementById('status');
  const loadingDiv = document.getElementById('loading');
  const showDebugCheckbox = document.getElementById('showDebug');
  const debugPanel = document.getElementById('debugPanel');
  const debugLog = document.getElementById('debugLog');

  // Debug panel toggle
  showDebugCheckbox.addEventListener('change', function() {
    debugPanel.style.display = this.checked ? 'block' : 'none';
  });

  function logDebug(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = data 
      ? `${timestamp}: ${message}\n${JSON.stringify(data, null, 2)}`
      : `${timestamp}: ${message}`;
    
    console.log(logMessage);
    debugLog.textContent += logMessage + '\n';
    debugLog.scrollTop = debugLog.scrollHeight;
    
    statusDiv.textContent = message;
    statusDiv.className = 'status';
  }

  function logError(message, error = null) {
    const timestamp = new Date().toISOString();
    const errorMessage = error 
      ? `${timestamp}: ERROR: ${message}\nError: ${error.message}\nStack: ${error.stack}`
      : `${timestamp}: ERROR: ${message}`;
    
    console.error(errorMessage);
    debugLog.textContent += errorMessage + '\n';
    debugLog.scrollTop = debugLog.scrollHeight;
    
    statusDiv.textContent = `Error: ${message}`;
    statusDiv.className = 'status error';
  }

  // Load saved API key
  chrome.storage.sync.get(['apiKey'], function(data) {
    apiKeyInput.value = data.apiKey || '';
    analyzeButton.disabled = !data.apiKey;
    logDebug('API key loaded from storage');
  });

  // Save API key when changed
  apiKeyInput.addEventListener('input', function() {
    const apiKey = apiKeyInput.value.trim();
    chrome.storage.sync.set({ apiKey });
    analyzeButton.disabled = !apiKey;
    
    if (apiKey) {
      logDebug('API key saved');
      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = 'status';
      }, 2000);
    }
  });

  // Handle analyze button click
  analyzeButton.addEventListener('click', async function() {
    const apiKey = apiKeyInput.value.trim();
    debugLog.textContent = '';
    
    if (!apiKey) {
      logError('No API key provided');
      return;
    }

    if (!apiKey.startsWith('sk-')) {
      logError('Invalid API key format');
      return;
    }

    analyzeButton.disabled = true;
    loadingDiv.style.display = 'block';
    
    try {
      // Get tab before closing popup
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tab.id;
      logDebug('Active tab retrieved', { tabId: tabId });

      if (!tab.id) {
        throw new Error('Cannot access tab');
      }

      // Capture screenshot before closing popup
      logDebug('Capturing screenshot...');
      const screenshot = await chrome.tabs.captureVisibleTab(null, {
        format: 'png'
      });
      logDebug('Screenshot captured', { dataLength: screenshot.length });

      // Start the analysis process
      logDebug('Starting analysis process');

      // Store data and close popup
      globalScreenshot = screenshot;
      
      // Send message to background script
      logDebug('Sending to Claude API...');
      const apiResponse = await sendToClaudeAPI(apiKey, screenshot);
      
      if (apiResponse.content && apiResponse.content.length > 0) {
        logDebug('Processing API response', apiResponse);
        const answer = processClaudeResponse(apiResponse.content[0].text);
        
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          function: showAnswerInPage,
          args: [answer]
        });
        
        logDebug('Answer displayed in page');
      } else {
        throw new Error('No content in API response');
      }

      // Close the popup
      window.close();

    } catch (error) {
      logError('Analysis failed', error);
      
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: showErrorInPage,
          args: [error.message]
        });
      } catch (e) {
        logError('Failed to show error in page', e);
      }
    } finally {
      analyzeButton.disabled = false;
      loadingDiv.style.display = 'none';
    }
  });
});

async function sendToClaudeAPI(apiKey, screenshot) {
  console.log('Sending request via background script');
  
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'CLAUDE_API_REQUEST',
      apiKey,
      screenshot
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('Chrome runtime error:', chrome.runtime.lastError);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error('No response from background script'));
        return;
      }

      if (!response.success) {
        reject(new Error(response.error || 'Unknown error'));
        return;
      }

      resolve(response.data);
    });
  });
}

function processClaudeResponse(response) {
  console.log('Processing response:', response);
  
  // First, check if it's a multiple choice response
  const mcPattern = /correct (answer|option|choice) is (?:option )?([A-D])/i;
  const mcMatch = response.match(mcPattern);
  
  if (mcMatch) {
    console.log('Detected multiple choice answer:', mcMatch[2]);
    return {
      type: 'multiple_choice',
      choice: mcMatch[2]
    };
  }
  
  // Check if there's an answer in the response
  if (response.includes('Answer:')) {
    const answer = response.split('Answer:')[1].trim();
    console.log('Detected text answer:', answer);
    return {
      type: 'text',
      text: answer
    };
  }
  
  // If no specific format is detected, return the whole response
  console.log('Using full response as answer');
  return {
    type: 'text',
    text: response.trim()
  };
}

function showAnswerInPage(answer) {
  let container = document.getElementById('claude-qa-container');
  if (container) {
    container.remove();
  }

  container = document.createElement('div');
  container.id = 'claude-qa-container';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;
    font-family: Arial, sans-serif;
    transition: opacity 0.3s ease;
  `;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    overflow: hidden;
    max-width: 300px;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s ease;
  `;

  // Fade in animation
  setTimeout(() => {
    wrapper.style.opacity = '1';
    wrapper.style.transform = 'translateY(0)';
  }, 100);

  if (answer.type === 'multiple_choice') {
    const badge = document.createElement('div');
    badge.style.cssText = `
      background-color: #4CAF50;
      color: white;
      padding: 12px 24px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    `;
    badge.textContent = `Option ${answer.choice}`;
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      wrapper.style.opacity = '0';
      wrapper.style.transform = 'translateY(10px)';
      setTimeout(() => container.remove(), 300);
    }, 5000);
    
    wrapper.appendChild(badge);
  } else {
    const button = document.createElement('button');
    button.style.cssText = `
      background-color: #2196F3;
      color: white;
      padding: 12px 24px;
      border: none;
      width: 100%;
      cursor: pointer;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.3s ease;
      font-size: 14px;
    `;
    button.textContent = 'Copy Answer';
    
    button.addEventListener('click', () => {
      navigator.clipboard.writeText(answer.text);
      button.textContent = 'Copied!';
      button.style.backgroundColor = '#4CAF50';
      
      // Fade out and remove
      setTimeout(() => {
        wrapper.style.opacity = '0';
        wrapper.style.transform = 'translateY(10px)';
        setTimeout(() => container.remove(), 300);
      }, 1000);
    });
    
    wrapper.appendChild(button);
  }

  container.appendChild(wrapper);
  document.body.appendChild(container);
}

function showErrorInPage(errorMessage) {
  let container = document.getElementById('claude-qa-container');
  if (container) {
    container.remove();
  }

  container = document.createElement('div');
  container.id = 'claude-qa-container';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;
    font-family: Arial, sans-serif;
    transition: opacity 0.3s ease;
  `;

  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    background-color: #f44336;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 300px;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s ease;
    font-size: 14px;
  `;
  errorDiv.textContent = `Error: ${errorMessage}`;
  
  container.appendChild(errorDiv);
  document.body.appendChild(container);

  // Fade in
  setTimeout(() => {
    errorDiv.style.opacity = '1';
    errorDiv.style.transform = 'translateY(0)';
  }, 100);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    errorDiv.style.opacity = '0';
    errorDiv.style.transform = 'translateY(10px)';
    setTimeout(() => container.remove(), 300);
  }, 5000);
}
