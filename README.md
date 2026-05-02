# 🦌 Ania's Deer Guardian

A touch-friendly browser game where Ania protects deer from giant ticks in a beautiful forest. Choose your difficulty, swat the ticks before they reach the deer, and unlock a birthday surprise!

## 🎮 How to Play

- Pick a difficulty: **Easy**, **Normal**, or **Hard**
- **Tap / click** on ticks to swat them before they reach the deer
- Each swatted tick = **+10 points**
- Too many ticks reach a deer → the deer dies
- 3 dead deer → **game over**
- Reach the target score to win 🎂

## 🚀 Deploy to GitHub Pages

1. Push this repo to GitHub:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   ```

2. Go to your repo on GitHub → **Settings** → **Pages**

3. Under **Source**, select **Deploy from a branch**

4. Pick the **main** branch and **/ (root)** folder, then click **Save**

5. After a minute or two your game will be live at:
   ```
   https://YOUR_USERNAME.github.io/YOUR_REPO/
   ```

That's it — no build step required.

## 📁 Project Structure

```
├── index.html      # Game page (cache-busting loader)
├── game.js         # All game logic
├── assets/
│   └── ania.png    # Character image
└── README.md
```

## 🔄 Caching

Assets are loaded with a `Date.now()` cache-buster, so players always get the latest version on page load — no force-refresh needed.
