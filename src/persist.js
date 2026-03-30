export async function readPersisted(key) {
  try {
    const cloud = await window.storage?.get?.(key);
    if (cloud?.value != null) return cloud.value;
  } catch {
    // noop
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writePersisted(key, value) {
  let ok = false;
  try {
    await window.storage?.set?.(key, value);
    ok = true;
  } catch {
    // noop
  }
  try {
    window.localStorage.setItem(key, value);
    ok = true;
  } catch {
    // noop
  }
  return ok;
}
