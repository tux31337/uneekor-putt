import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);
if (new URLSearchParams(window.location.search).get('review') === 'grass') {
  void import('./ui/GrassReview').then(({ default: Review }) => root.render(<React.StrictMode><Review /></React.StrictMode>));
} else if (new URLSearchParams(window.location.search).get('review') === 'tree') {
  void import('./ui/TreeQualityReview').then(({ default: Review }) => root.render(<React.StrictMode><Review /></React.StrictMode>));
} else if (new URLSearchParams(window.location.search).get('review') === 'vegetation') {
  void import('./ui/VegetationReview').then(({ default: Review }) => root.render(<React.StrictMode><Review /></React.StrictMode>));
} else root.render(<React.StrictMode><App /></React.StrictMode>);
