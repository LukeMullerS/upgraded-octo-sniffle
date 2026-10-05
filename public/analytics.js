// Vercel Web Analytics
// Initializes Vercel Web Analytics tracking
// This uses the queue-based approach that works without bundling

(function() {
  // Initialize the queue
  window.va = window.va || function() {
    (window.vaq = window.vaq || []).push(arguments);
  };
  
  // Create and inject the script
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  
  // Only inject if running on Vercel (in production)
  if (document.head) {
    document.head.appendChild(script);
  }
})();
