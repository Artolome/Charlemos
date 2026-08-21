@echo off
title Charlemos - serveur local
echo.
echo   ¡Charlemos! demarre... le navigateur va s'ouvrir sur http://localhost:5173
echo   (laisser cette fenetre ouverte pendant l'utilisation, Ctrl+C pour arreter)
echo.
cd /d C:\Users\ameli\dev\charlemos
start "" http://localhost:5173
npm run dev
