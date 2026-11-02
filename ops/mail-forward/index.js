// Forwards mail for support@ / privacy@musely.net to every operator in FORWARD_TO.
// A failed forward to one operator does not stop the other; if none succeed the message is rejected
// so the sender gets a bounce instead of silent loss.
export default {
  async email(message, env) {
    const to = env.FORWARD_TO.split(',').map(s => s.trim()).filter(Boolean);
    const results = await Promise.allSettled(to.map(addr => message.forward(addr)));
    results.forEach((r, i) => { if (r.status === 'rejected') console.error('forward failed', to[i], String(r.reason)); });
    if (!results.some(r => r.status === 'fulfilled')) message.setReject('Musely support mailbox is temporarily unavailable');
  },
};
