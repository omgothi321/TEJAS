const axios = require('axios');

const apiKey = 'gsk_66vVlT3vVvVvVvVvVvVv0tFx'; // I need to get the real key from config.json or environment
// Wait, I should read it from the config file.

async function testGroq() {
  const fs = require('fs-extra');
  const path = require('path');
  const configPath = path.join(process.env.HOME, '.tejas', 'config.json');
  const config = await fs.readJson(configPath);
  const key = config.api_keys.groq;

  console.log('Testing Groq with key:', key.slice(0, 10) + '...');

  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'hello' }]
    }, {
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    console.log('Success:', res.data.choices[0].message.content);
  } catch (err) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

testGroq();
