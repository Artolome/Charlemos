@echo off
title Charlemos - diffusion en classe (reseau local)
cd /d C:\Users\ameli\dev\charlemos
echo.
echo  ============================================================
echo   CHARLEMOS - MODE CLASSE (postes du meme reseau)
echo  ============================================================
echo.
echo  Adresse(s) IPv4 de ce poste :
ipconfig | findstr /i "IPv4"
echo.
echo  1. Si Windows demande d'autoriser Node.js dans le pare-feu :
echo     cliquer AUTORISER (cocher aussi "reseaux prives").
echo  2. Sur chaque poste eleve, ouvrir dans Chrome ou Edge :
echo     http://ADRESSE-IP-CI-DESSUS:4173
echo     (exemple : http://192.168.1.20:4173)
echo.
echo  Laisser cette fenetre ouverte pendant le cours.
echo  Pour arreter : Ctrl+C ou fermer la fenetre.
echo  ============================================================
echo.
call npm run classe
