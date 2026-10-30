// Payments helper shared by the browser and the server.
// DEMO MODE (no Stripe keys): everything here is simulated. No keys, no network calls, no real money.
// LIVE MODE (STRIPE_CLIENT_ID + STRIPE_SECRET_KEY set): the server creates real PaymentIntents and refunds
// on the owner's connected Stripe account; these helpers are then only used for display math.
(function (root) {
  const r2 = n => Math.round(n * 100) / 100;
  const PAY = {
    TEST_CARD: '4242 4242 4242 4242',
    cardFee: amt => r2(amt * 0.029 + 0.30), // Stripe standard card pricing, paid by the restaurant
    validCard: num => { const d = String(num).replace(/\D/g, ''); if (d.length < 13) return false; let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; },
    // Simulated PaymentIntent. 4000 0000 0000 0002 is Stripe's test "declined" card, we mimic that.
    charge: ({ amount, method, card }) => {
      if (method === 'store') return { ok: true, method: 'store', id: 'pay_instore_' + Date.now(), label: 'Pay at pickup', fee: 0, demo: true };
      const d = String(card || '').replace(/\D/g, '');
      if (!PAY.validCard(d)) return { ok: false, error: 'That card number does not look right. Use the test card 4242 4242 4242 4242.' };
      if (d === '4000000000000002') return { ok: false, error: 'Card declined (test decline card).' };
      return { ok: true, method: 'card', id: 'pi_demo_' + Math.random().toString(36).slice(2, 12), label: 'Card •••• ' + d.slice(-4) + ' (demo)', last4: d.slice(-4), fee: PAY.cardFee(amount), demo: true };
    },
    // Simulated refund (full or partial). Mirrors Stripe's Refund object shape loosely.
    refund: ({ paymentId, amount, already = 0, total }) => {
      const a = r2(+amount);
      if (!(a > 0)) return { ok: false, error: 'Refund amount must be more than $0.' };
      if (r2(already + a) > r2(total) + 0.001) return { ok: false, error: 'That is more than what is left to refund (' + '$' + r2(total - already).toFixed(2) + ').' };
      return { ok: true, id: 're_demo_' + Math.random().toString(36).slice(2, 12), amount: a, payment: paymentId, demo: true };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PAY; else root.PAY = PAY;
})(typeof window !== 'undefined' ? window : globalThis);
