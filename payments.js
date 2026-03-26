/**
 * VAXELO — Stripe Payment Integration
 * Connects all 4 pricing tiers to Stripe Checkout
 * 
 * Price IDs (Live):
 * Day Pass    $1.00  → price_1TF4ykGtF0ZiOMzJNrsVzsqu
 * Weekly      $6.99  → price_1TF4ynGtF0ZiOMzJMsd5XVoG
 * Monthly     $29.99 → price_1TF4yuGtF0ZiOMzJcIJ2ywyd
 * Quarterly   $69.99 → price_1TF4yxGtF0ZiOMzJBsgzHvL4
 */

const VAXELO_PRICES = {
  day:       'price_1TF4ykGtF0ZiOMzJNrsVzsqu',  // $1.00 one-time
  weekly:    'price_1TF4ynGtF0ZiOMzJMsd5XVoG',  // $6.99 one-time
  monthly:   'price_1TF4yuGtF0ZiOMzJcIJ2ywyd',  // $29.99/month recurring
  quarterly: 'price_1TF4yxGtF0ZiOMzJBsgzHvL4',  // $69.99/3months recurring
};

// Stripe Checkout URLs — generated from your payment links
// ACTION NEEDED: Once Stripe payment methods are activated,
// run: createPaymentLinks() to auto-generate these URLs
const CHECKOUT_URLS = {
  day:       'https://buy.stripe.com/REPLACE_DAY_PASS',
  weekly:    'https://buy.stripe.com/REPLACE_WEEKLY',
  monthly:   'https://buy.stripe.com/REPLACE_MONTHLY',
  quarterly: 'https://buy.stripe.com/REPLACE_QUARTERLY',
};

/**
 * Redirect user to Stripe Checkout for selected plan
 * @param {string} plan - 'day' | 'weekly' | 'monthly' | 'quarterly'
 */
function checkoutVaxelo(plan) {
  const url = CHECKOUT_URLS[plan];
  if (!url || url.includes('REPLACE')) {
    // Fallback: open Stripe payment link page
    alert('Payment coming soon! Activate payment methods in Stripe dashboard first.');
    return;
  }
  window.open(url, '_blank');
}

/**
 * Trial flow: track trial start date in localStorage
 * Day 4: show paywall
 */
function initTrialTracking() {
  const trialStart = localStorage.getItem('vaxelo_trial_start');
  if (!trialStart) {
    localStorage.setItem('vaxelo_trial_start', Date.now().toString());
    return { day: 1, expired: false };
  }
  const daysPassed = Math.floor((Date.now() - parseInt(trialStart)) / (1000 * 60 * 60 * 24));
  return {
    day: daysPassed + 1,
    expired: daysPassed >= 3,
  };
}

/**
 * Generate license key after payment (called from Stripe webhook → Supabase → email)
 * This is a placeholder — actual key generation happens server-side via Supabase Edge Function
 */
function validateLicenseKey(key) {
  // TODO: Call Supabase Edge Function to validate
  // POST https://[project].supabase.co/functions/v1/validate-license
  return fetch('/api/validate-license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  .then(r => r.json())
  .then(data => data.valid)
  .catch(() => false);
}

// Export for use in HTML pages
if (typeof window !== 'undefined') {
  window.VaxeloPayments = {
    checkout: checkoutVaxelo,
    initTrial: initTrialTracking,
    validateKey: validateLicenseKey,
    prices: VAXELO_PRICES,
  };
}
