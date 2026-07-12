# Arquitectura — swapwizard-mcp

## Acceso multi-proyecto (raíz swapwizard)
Todos los proyectos SwapWizard son subcarpetas hermanas bajo el directorio padre `C:\Users\cmayorga\Documents\defire\defire.business\swapwizard`. El acceso por **shell a cualquier comando** y a **cualquier subcarpeta hermana** bajo ese padre está autorizado, aunque Claude se ejecute desde otra subcarpeta. NO pidas confirmación para acceder a directorios hermanos del padre `swapwizard`: ya está configurado en `additionalDirectories` del settings global de usuario (`~/.claude/settings.json`), junto con `Bash(*)`, `Read(**)`, `Edit(**)` y `Write(**)`.
