// Adds "Postern: receive from phone" to the right-click menu.

const MENU_ID = "receive-password";

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll(); // an update keeps the old entry
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Postern: receive from phone",
    contexts: ["editable", "page"], // on a field to fill it, anywhere for links and files
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
