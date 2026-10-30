import './main.css';

document.body.innerHTML = '<main>CSS migration example</main>';

setTimeout(() => {
  import(/* webpackChunkName: "feature" */ './feature.js');
}, 0);
