// Host-only scorer evidence. Export only the requested public product facts.
export function productEvidence() {
  const cut = (value, max) => value?.replace(/\s+/g, ' ').trim().slice(0, max);
  const canonical = (value) => {
    try {
      const url = new URL(value, location.href);
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return undefined;
    }
  };
  const challenge =
    /captcha|validateCaptcha/i.test(location.href) ||
    /robot check|enter the characters|automated access/i.test(document.title);
  if (challenge) return [{ url: canonical(location.href), challenge: true }];
  const title = cut(document.querySelector('#productTitle')?.textContent, 600);
  if (title)
    return [
      {
        source: 'detail',
        url: canonical(location.href),
        title,
        price: cut(
          document.querySelector(
            '#corePriceDisplay_desktop_feature_div .a-offscreen, #corePrice_feature_div .a-offscreen',
          )?.textContent,
          80,
        ),
        availability: cut(
          document.querySelector('#availability')?.textContent,
          300,
        ),
        challenge: false,
      },
    ];
  return [...document.querySelectorAll('.s-result-item[data-asin]')]
    .flatMap((card) => {
      const title = cut(card.querySelector('h2')?.textContent, 600);
      if (!title || !/WH-1000XM5|Bose.*QuietComfort/i.test(title)) return [];
      const link = card.querySelector('a:has(h2), h2 a');
      return [
        {
          source: 'search',
          url: canonical(link?.getAttribute('href')),
          title,
          price: cut(
            card.querySelector('.a-price .a-offscreen')?.textContent,
            80,
          ),
          availability: undefined,
          challenge: false,
        },
      ];
    })
    .slice(0, 8);
}
