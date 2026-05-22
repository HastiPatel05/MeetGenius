// background.js
// Set up the side panel behavior to open on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

// We will let panel.js handle the actual recording and API calls since it has access to the DOM and MediaRecorder.
