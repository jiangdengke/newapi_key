export const THEME_STORAGE_KEY = "newapi-key-theme";

export const THEME_INITIALIZATION_SCRIPT = (
  `try{var theme=localStorage.getItem("${THEME_STORAGE_KEY}");`
  + `if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch(error){}`
);
