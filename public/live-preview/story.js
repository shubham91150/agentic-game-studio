/* Ashes of St. Vermilion — story content (Stage 1).
 * Plain data only: no rendering, no audio, no THREE use here.
 * r128 global style: exposes window.StV_Story. No module syntax.
 */
(function () {
  'use strict';

  window.StV_Story = {
    TITLE: 'ASHES OF ST. VERMILION',
    INTRO: [
      {
        title: 'PHAS GAYA',
        body: 'Kabir jali hui St. Vermilion convent school me phas gaya hai. ' +
          'Raat gehari hai aur barish thamne ka naam nahi le rahi.'
      },
      {
        title: 'GUN-GUNAHAT',
        body: 'Andheri galiyon me Agatha ki gun-gunahat goonj rahi hai. ' +
          'Torch jalaye rakho — aur shor mat karo.'
      },
      {
        title: 'CHAPEL KEY',
        body: 'Nikasi ka ek hi rasta hai: Classroom B me chhupi Chapel Key dhoondo. ' +
          'Chapel ka darwaza kholo... jaldi.'
      }
    ],
    OBJECTIVES: [
      'Chapel Key dhoondo — Classroom B',
      'Chapel ka darwaza kholo (jaldi...)'
    ]
  };
})();
