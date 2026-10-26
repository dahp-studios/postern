// Adds "Receive password from phone" to the right-click menu on text fields.

const MENU_ID = "receive-password";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Receive password from phone",
    contexts: ["editable"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch {
    // openPopup isn't available everywhere (older Chrome); use a small window instead.
    await chrome.windows.create({
      url: `popup.html?tab=${tab.id}`,
      type: "popup",
      width: 340,
      height: 480,
    });
  }
});
