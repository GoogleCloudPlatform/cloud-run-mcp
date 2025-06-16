
const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = '.mcpconfig';

function findConfigFile() {
  let dir = process.cwd();
  while (dir !== '/') {
    const configFile = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(configFile)) {
      return configFile;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function loadConfig() {
  const configFile = findConfigFile();
  if (!configFile) {
    return {};
  }
  const content = fs.readFileSync(configFile, 'utf8');
  return JSON.parse(content);
}

module.exports = {
  loadConfig,
};
