// SIMULATED Stripe Connect. Test mode only: no keys, no network calls, no real money.
// Later: Christy connects her own Stripe account (Connect Standard/Express onboarding),
// the server creates PaymentIntents with transfer_data.destination = her account id.
(function () {
  const KEY = 'ctq_stripe';
  const r2 = n => Math.round(n * 100) / 100;
  const get = () => JSON.parse(localStorage.getItem(KEY) || '{"status":"none"}');
  const set = v => localStorage.setItem(KEY, JSON.stringify(v));
  const PAY = {
    TEST_CARD: '4242 4242 4242 4242',
    account: get,
    // Onboarding steps mirror Stripe Connect: business info -> bank -> verified
    startConnect: biz => { const a = { status: 'pending', business: biz || "Kimmie’s-Christy's Tasty Queen", id: 'acct_test_' + Math.random().toString(36).slice(2, 10), started: new Date().toISOString() }; set(a); return a; },
    finishConnect: () => { const a = get(); a.status = 'connected'; a.bank = 'Test Bank •••• 6789'; a.connected = new Date().toISOString(); set(a); return a; },
    disconnect: () => set({ status: 'none' }),
    cardFee: amt => r2(amt * 0.029 + 0.30), // Stripe standard card pricing, paid by the restaurant
    validCard: num => { const d = String(num).replace(/\D/g, ''); if (d.length < 13) return false; let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; },
    // Fake PaymentIntent. Card 4000 0000 0000 0002 is Stripe's test "declined" card, we mimic that.
    charge: ({ amount, method, card }) => {
      if (method === 'store') return { ok: true, id: 'pay_instore_' + Date.now(), label: 'Pay at pickup', fee: 0, simulated: true };
      const d = String(card || '').replace(/\D/g, '');
      if (!PAY.validCard(d)) return { ok: false, error: 'That card number does not look right. Use the test card 4242 4242 4242 4242.' };
      if (d === '4000000000000002') return { ok: false, error: 'Card declined (test decline card).' };
      const acct = get();
      return { ok: true, id: 'pi_test_' + Math.random().toString(36).slice(2, 12), label: 'Card •••• ' + d.slice(-4) + ' (test)', fee: PAY.cardFee(amount), payout: r2(amount - PAY.cardFee(amount)), destination: acct.status === 'connected' ? acct.id : null, simulated: true };
    }
  };
  window.PAY = PAY;
})();
