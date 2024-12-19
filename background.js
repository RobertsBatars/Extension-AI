console.log('Background script loaded');

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CLAUDE_API_REQUEST') {
    console.log('Received API request');
    
    handleClaudeRequestWithRetry(request)
      .then(result => {
        console.log('API request successful', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('API request failed after retries:', error);
        sendResponse({
          success: false,
          error: error.message || 'API request failed'
        });
      });
    
    return true;
  }
});

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function handleClaudeRequestWithRetry(request, attempt = 1) {
  try {
    return await handleClaudeRequest(request);
  } catch (error) {
    console.error(`Attempt ${attempt} failed:`, error);
    
    if (attempt < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY}ms... (Attempt ${attempt + 1}/${MAX_RETRIES})`);
      await wait(RETRY_DELAY);
      return handleClaudeRequestWithRetry(request, attempt + 1);
    }
    throw error;
  }
}

async function handleClaudeRequest(request) {
  try {
    console.log('Preparing API request');
    
    const base64Data = request.screenshot.split(',')[1];
    
    const requestBody = {
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 4096,
      temperature: 0.3, // Lower temperature for more focused answers
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyze this screenshot and check if it contains any questions. If it does, provide your answer. If it\'s a multiple choice question, just specify the correct option in this format: "correct answer is A" (replace A with the actual option, only accepted options are [A-Z], therefore if the 3rd answer is correct, the correct option will be "C") without any other text or explanations. If it is open ended question, provide detailed answer without any without any text that is usually present in AI responses (generate it). If there are no questions, just say "correct answer is NO QUESTION FOUND".',
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: base64Data
            }
          }
        ]
      }]
    };

    console.log('Sending request to Claude API');
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': request.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      console.log('Received response:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error:', errorText);
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Parsed response data:', data);

      if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
        throw new Error('Invalid response format from API');
      }

      return {
        success: true,
        data: data
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('Error in handleClaudeRequest:', error);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
}

self.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
});

// Keep service worker alive
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

console.log('Background script initialization complete');
