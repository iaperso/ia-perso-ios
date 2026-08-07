# Connecter ComfyUI à IA Perso

IA Perso v12 peut utiliser un serveur ComfyUI comme moteur d'images principal, puis Hugging Face ZeroGPU en secours.

## Ce qu'il faut côté ComfyUI

1. Lancer ComfyUI avec son API accessible depuis l'iPhone.
2. Autoriser les requêtes du navigateur (CORS), par exemple avec l'option `--enable-cors-header` si elle est disponible dans votre installation.
3. Dans ComfyUI, construire et tester un workflow texte-vers-image.
4. Exporter le workflow au format **API JSON** (pas le JSON normal de l'interface).
5. Dans IA Perso > ⚙︎ Réglages :
   - entrer l'URL de ComfyUI ;
   - toucher **Tester ComfyUI** ;
   - toucher **Importer workflow JSON** et choisir le fichier exporté ;
   - laisser le mode **Auto** ou choisir **ComfyUI uniquement**.

IA Perso cherche automatiquement le premier nœud `CLIPTextEncode` positif, remplace son texte par le prompt saisi, adapte `EmptyLatentImage` à la taille choisie et randomise les seeds des nœuds courants (`KSampler`, `KSamplerAdvanced`, `RandomNoise`).

## Confidentialité

L'URL ComfyUI, le workflow et l'éventuel token Hugging Face restent dans le stockage local du navigateur de l'iPhone. Le frontend statique ne les envoie pas à Vercel.

## Limites

ComfyUI lui-même n'impose pas de quota de générations. Les limites viennent du GPU, de la mémoire et de l'hébergement utilisé. Hugging Face ZeroGPU reste soumis à ses quotas et files d'attente.
