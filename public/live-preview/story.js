/* Ashes of St. Vermilion — story content (Stage 1+2 ext).
 * Plain data only: no rendering, no audio, no THREE use here.
 * r128 global style: exposes window.StV_Story. No module syntax.
 * Stage 2+3: OBJECTIVES gains the door->escape chain, GAMEOVER lines added.
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
      'Chapel ka darwaza kholo — Agatha se bach ke',
      'BHAGO — chapel ke darwaze se niklo!'
    ],
    /* Stage 2+3 additive: gameover flavor lines (ui picks one). */
    GAMEOVER: [
      'Agatha ne tumhe pakad liya. Uski lantern ab tumhare liye jalti hai.',
      'Galiyon me daudna kaafi nahi tha. Woh har darwaze ke peeche thi.',
      'Chapel itna paas tha... par Maa ki pakad se koi nahi bhaagta.'
    ]
  };
})();
