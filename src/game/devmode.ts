/** True when the page was opened with ?devmode=true (enables the cheat menu, disables high scores). */
export const DEV_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('devmode') === 'true';
