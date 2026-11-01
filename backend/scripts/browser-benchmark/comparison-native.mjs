// Host-only fixture setup; never exposed as a model tool.
export async function prepareNativeFixture(android, owner) {
  await android.call(owner, 'android_launch_app', {
    packageName: 'dev.pal.securefixture',
  });
  let view = await android.secure(owner, { action: 'inspect' });
  const validApp = () =>
    view.status === 'ready' &&
    view.identity.packageName === 'dev.pal.securefixture';
  if (!validApp()) throw Error('Owned native fixture not ready');
  const reset = view.elements.find((e) => /^start again$/i.test(e.text.trim()));
  if (reset) {
    await android.call(owner, 'android_tap', { ref: reset.ref });
    view = await android.secure(owner, { action: 'inspect' });
  }
  if (
    !validApp() ||
    !view.elements.some((e) => e.text === 'Pal secure fixture — Username') ||
    !view.inputs.some((e) => e.label === 'Email or username')
  )
    throw Error('Owned native fixture did not reach fresh username stage');
  return view;
}
