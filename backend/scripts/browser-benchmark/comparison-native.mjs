// Host-only fixture setup; never exposed as a model tool.
export async function prepareNativeFixture(android, owner) {
  await android.call(owner, 'android_launch_app', {
    packageName: 'dev.pal.securefixture',
  });
  const screen = await android.call(owner, 'android_inspect', {
    format: 'json',
  });
  if (screen.isError) throw Error('Owned native fixture not ready');
  const payload = screen.content.find((e) => e.type === 'text').text;
  const elements = JSON.parse(payload.slice(payload.indexOf('[')));
  const reset = elements.find((e) =>
    /^start again$/i.test((e.text || e.label || '').trim()),
  );
  if (reset) await android.call(owner, 'android_tap', { ref: reset.ref });
  const view = await android.secure(owner, { action: 'inspect' });
  if (
    view.status !== 'ready' ||
    view.identity.packageName !== 'dev.pal.securefixture' ||
    !view.inputs.some((e) => e.label === 'Email or username')
  )
    throw Error('Owned native fixture did not reach fresh username stage');
  return view;
}
