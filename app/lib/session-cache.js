// Session cache invalidation lives in its own module so firebase.js and
// crm-data.js are not circularly dependent: firebase.js used to import
// resetSessionCache from crm-data.js while crm-data.js imports the Firebase
// instances from firebase.js. That cycle made crm-data.js evaluate before
// firebase.js finished, so its `storage` binding was undefined at module
// evaluation time and the first document upload crashed inside the SDK with
// "Cannot read properties of undefined (reading 'path')".
let invalidators = new Set();

export function registerSessionReset(callback) {
  invalidators.add(callback);
  return () => invalidators.delete(callback);
}

export function resetSessionCache() {
  invalidators.forEach((callback) => callback());
}
