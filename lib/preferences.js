export const THEME_STORAGE_KEY = "newapi-key-theme";
export const SIDEBAR_STORAGE_KEY = "newapi-key-sidebar";

export const PREFERENCES_INITIALIZATION_SCRIPT = (
  `try{var theme=localStorage.getItem("${THEME_STORAGE_KEY}");`
  + `if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme;`
  + `if(localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed")`
  + `document.documentElement.dataset.sidebar="collapsed"}catch(error){}`
);
