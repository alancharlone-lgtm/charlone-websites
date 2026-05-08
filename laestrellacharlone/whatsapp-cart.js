/**
 * ============================================================
 * WhatsApp Cart — Motor de Carrito Universal
 * ============================================================
 * Carrito de compras con checkout por WhatsApp.
 * Se conecta a un productos.json local o Google Sheets.
 * 
 * Uso: incluir este script en cualquier HTML de tienda.
 * ============================================================
 */

(function () {
  'use strict';

  // ============================================================
  // CONFIGURACIÓN — Cambiar SHEET_ID para conectar Google Sheets
  // ============================================================
  const CONFIG = {
    // Para usar Google Sheets, poner el ID del Sheet publicado.
    // Ejemplo: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
    // Para usar JSON local, dejar en null.
    SHEET_ID: null,

    // Nombre de la pestaña del Sheet (por defecto 'Productos')
    SHEET_TAB: 'Productos',

    // Fallback: archivo JSON local
    LOCAL_JSON: 'productos.json',
  };

  // ============================================================
  // STATE
  // ============================================================
  let cart = [];
  let storeData = null;

  // ============================================================
  // HELPERS
  // ============================================================
  function formatPrice(n) {
    return '$' + n.toLocaleString('es-AR');
  }

  function getTotal() {
    return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  function getItemCount() {
    return cart.reduce((sum, item) => sum + item.qty, 0);
  }

  /** Get images array from product (supports both `image` and `images` field) */
  function getProductImages(p) {
    if (p.images && Array.isArray(p.images) && p.images.length > 0) return p.images;
    if (p.image) return [p.image];
    return ['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect fill="%23eee" width="400" height="400"/><text x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23aaa" font-size="18">Sin foto</text></svg>'];
  }

  /** Slide carousel for a product card */
  function slideCarousel(productId, direction) {
    const card = document.querySelector(`.product-card[data-id="${productId}"]`);
    if (!card) return;
    const track = card.querySelector('.carousel-track');
    const dots = card.querySelectorAll('.carousel-dot');
    const slides = track.querySelectorAll('.carousel-slide');
    const total = slides.length;
    let current = parseInt(track.dataset.current || '0');

    current = (current + direction + total) % total;
    track.dataset.current = current;
    track.style.transform = `translateX(-${current * 100}%)`;

    dots.forEach((d, i) => {
      d.classList.toggle('bg-white', i === current);
      d.classList.toggle('bg-white/50', i !== current);
    });
  }

  // Extrae el ID de un link de YouTube
  function getYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  // ============================================================
  // VIDEO MODAL
  // ============================================================
  function openVideoModal(videoUrl) {
    const ytId = getYouTubeId(videoUrl);
    const driveMatch = videoUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    const modal = document.getElementById('video-modal');
    const container = document.getElementById('video-modal-content');

    if (ytId) {
      container.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0" 
        class="w-full aspect-video" frameborder="0" 
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
        allowfullscreen></iframe>`;
    } else if (driveMatch) {
      // Google Drive video embed
      container.innerHTML = `<iframe src="https://drive.google.com/file/d/${driveMatch[1]}/preview" 
        class="w-full aspect-video" frameborder="0" 
        allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    } else {
      // Video directo (MP4, etc.)
      container.innerHTML = `<video src="${videoUrl}" controls autoplay class="w-full aspect-video">Tu navegador no soporta video.</video>`;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => modal.querySelector('.modal-panel').classList.remove('scale-95', 'opacity-0'), 10);
  }

  function closeVideoModal() {
    const modal = document.getElementById('video-modal');
    const panel = modal.querySelector('.modal-panel');
    panel.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      document.getElementById('video-modal-content').innerHTML = '';
    }, 300);
  }

  // ============================================================
  // RENDER PRODUCT GRID
  // ============================================================
  function renderProducts(category) {
    const grid = document.getElementById('products-grid');
    const pills = document.querySelectorAll('.category-pill');
    if (!grid || !storeData) return;

    // Update active pill
    pills.forEach(p => {
      p.classList.remove('bg-brand', 'text-surface');
      p.classList.add('bg-transparent', 'text-brand');
      if (p.dataset.category === (category || 'all')) {
        p.classList.add('bg-brand', 'text-surface');
        p.classList.remove('bg-transparent', 'text-brand');
      }
    });

    const products = storeData.products.filter(p => {
      if (!p.active) return false;
      if (!category || category === 'all') return true;
      return p.category === category;
    });

    grid.innerHTML = products.map(p => {
      const hasVideo = p.video && p.video.trim() !== '';
      const images = getProductImages(p);
      const totalSlides = images.length;
      const showCarousel = totalSlides > 1;

      return `
      <div class="group product-card" data-id="${p.id}">
        <div class="aspect-[3/4] bg-[#EAEAEA] mb-5 relative overflow-hidden">
          <!-- Carousel track -->
          <div class="carousel-track flex h-full transition-transform duration-300 ease-out" data-current="0" style="width:${totalSlides * 100}%">
            ${images.map(img => `
              <div class="carousel-slide h-full flex-shrink-0" style="width:${100 / totalSlides}%">
                <img src="${img}" alt="${p.name}" class="w-full h-full object-cover" loading="lazy">
              </div>
            `).join('')}
          </div>

          ${showCarousel ? `
          <!-- Arrows -->
          <button onclick="event.stopPropagation(); window._cart.slideCarousel(${p.id}, -1)"
            class="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center
                   text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-black/60">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <button onclick="event.stopPropagation(); window._cart.slideCarousel(${p.id}, 1)"
            class="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center
                   text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-black/60">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
          </button>
          <!-- Dots -->
          <div class="absolute bottom-12 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            ${images.map((_, i) => `<span class="carousel-dot w-2 h-2 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/50'} transition-colors cursor-pointer"></span>`).join('')}
          </div>
          ` : ''}

          ${hasVideo ? `
          <button onclick="event.stopPropagation(); window._cart.openVideoModal('${p.video}')"
            class="absolute top-3 right-3 z-10 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center
                   shadow-lg hover:bg-white hover:scale-110 transition-all duration-300">
            <svg class="w-4 h-4 ml-0.5 text-brand" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          ` : ''}

          <button onclick="window._cart.openSizeModal(${p.id})"
            class="absolute bottom-0 left-0 right-0 bg-brand text-surface py-3 text-xs tracking-[0.15em] uppercase font-medium
                   translate-y-full group-hover:translate-y-0 transition-transform duration-500 flex items-center justify-center gap-2 z-20">
            <span class="material-symbols-outlined text-base">add_shopping_cart</span>
            Agregar al carrito
          </button>
        </div>
        <div class="flex justify-between items-start gap-4">
          <div>
            <h4 class="font-serif text-lg mb-1 group-hover:text-brand-accent transition-colors">${p.name}</h4>
            <p class="text-xs text-text-muted font-light leading-relaxed">${p.description}</p>
          </div>
          <span class="text-sm font-medium whitespace-nowrap">${formatPrice(p.price)}</span>
        </div>
      </div>
    `}).join('');
  }

  // ============================================================
  // SIZE MODAL
  // ============================================================
  function openSizeModal(productId) {
    const product = storeData.products.find(p => p.id === productId);
    if (!product) return;

    // Skip modal if single size (e.g. "Único" or only 1 size available)
    if (!product.sizes || product.sizes.length === 0) {
      addToCart(productId, 'Único');
      return;
    }
    if (product.sizes.length === 1) {
      addToCart(productId, product.sizes[0]);
      return;
    }

    const modal = document.getElementById('size-modal');
    const content = document.getElementById('size-modal-content');

    const firstImage = getProductImages(product)[0];
    content.innerHTML = `
      <div class="flex gap-6 mb-8">
        <img src="${firstImage}" alt="${product.name}" class="w-24 h-32 object-cover rounded-sm flex-shrink-0">
        <div>
          <h3 class="font-serif text-2xl mb-1">${product.name}</h3>
          <p class="text-text-muted text-sm font-light mb-2">${product.description}</p>
          <p class="font-medium text-lg">${formatPrice(product.price)}</p>
        </div>
      </div>
      <p class="text-xs tracking-[0.2em] uppercase font-medium mb-4">Seleccioná tu talle</p>
      <div class="flex flex-wrap gap-3 mb-8">
        ${product.sizes.map((s, i) => `
          <button onclick="window._cart.addToCart(${product.id}, '${s}')"
            class="size-btn px-5 py-3 border border-black/20 text-sm hover:bg-brand hover:text-surface hover:border-brand transition-all">
            ${s}
          </button>
        `).join('')}
      </div>
      <button onclick="window._cart.closeSizeModal()" class="text-xs text-text-muted underline">Cancelar</button>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => modal.querySelector('.modal-panel').classList.remove('translate-y-8', 'opacity-0'), 10);
  }

  function closeSizeModal() {
    const modal = document.getElementById('size-modal');
    const panel = modal.querySelector('.modal-panel');
    panel.classList.add('translate-y-8', 'opacity-0');
    setTimeout(() => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }, 300);
  }

  // ============================================================
  // CART OPERATIONS
  // ============================================================
  function addToCart(productId, size) {
    const product = storeData.products.find(p => p.id === productId);
    if (!product) return;

    const existing = cart.find(i => i.id === productId && i.size === size);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        size: size,
        qty: 1
      });
    }

    closeSizeModal();
    renderCartDrawer();
    updateBadge();
    openCartDrawer();

    // Bounce animation on the floating button
    const fab = document.getElementById('cart-fab');
    if (fab) {
      fab.classList.add('scale-125');
      setTimeout(() => fab.classList.remove('scale-125'), 300);
    }
  }

  function removeFromCart(index) {
    cart.splice(index, 1);
    renderCartDrawer();
    updateBadge();
  }

  function changeQty(index, delta) {
    cart[index].qty += delta;
    if (cart[index].qty <= 0) cart.splice(index, 1);
    renderCartDrawer();
    updateBadge();
  }

  // ============================================================
  // CART DRAWER
  // ============================================================
  function openCartDrawer() {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('cart-overlay');
    drawer.classList.remove('translate-x-full');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    document.body.style.overflow = 'hidden';
  }

  function closeCartDrawer() {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('cart-overlay');
    drawer.classList.add('translate-x-full');
    overlay.classList.add('opacity-0');
    setTimeout(() => overlay.classList.add('hidden'), 300);
    document.body.style.overflow = '';
  }

  function renderCartDrawer() {
    const body = document.getElementById('cart-body');
    const footer = document.getElementById('cart-footer');
    if (!body) return;

    if (cart.length === 0) {
      body.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full text-center px-8">
          <span class="material-symbols-outlined text-6xl text-black/10 mb-6">shopping_bag</span>
          <p class="font-serif text-xl mb-2">Tu carrito está vacío</p>
          <p class="text-sm text-text-muted font-light">Explorá nuestra colección y agregá lo que te guste.</p>
        </div>
      `;
      footer.classList.add('hidden');
      return;
    }

    footer.classList.remove('hidden');

    body.innerHTML = cart.map((item, i) => `
      <div class="flex gap-4 py-5 border-b border-black/5">
        <img src="${item.image}" alt="${item.name}" class="w-20 h-24 object-cover flex-shrink-0">
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-start">
            <div class="min-w-0">
              <h4 class="font-serif text-sm truncate">${item.name}</h4>
              <p class="text-xs text-text-muted mt-0.5">Talle: ${item.size}</p>
            </div>
            <button onclick="window._cart.removeFromCart(${i})" class="text-text-muted hover:text-red-500 transition-colors ml-2 flex-shrink-0">
              <span class="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          <div class="flex justify-between items-center mt-3">
            <div class="flex items-center border border-black/10">
              <button onclick="window._cart.changeQty(${i}, -1)" class="px-2 py-1 text-xs hover:bg-black/5 transition-colors">−</button>
              <span class="px-3 py-1 text-xs font-medium">${item.qty}</span>
              <button onclick="window._cart.changeQty(${i}, 1)" class="px-2 py-1 text-xs hover:bg-black/5 transition-colors">+</button>
            </div>
            <span class="text-sm font-medium">${formatPrice(item.price * item.qty)}</span>
          </div>
        </div>
      </div>
    `).join('');

    // Update footer total
    document.getElementById('cart-total').textContent = formatPrice(getTotal());
    document.getElementById('cart-count-footer').textContent = `${getItemCount()} ${getItemCount() === 1 ? 'artículo' : 'artículos'}`;
  }

  function updateBadge() {
    const badge = document.getElementById('cart-badge');
    const count = getItemCount();
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  // ============================================================
  // WHATSAPP CHECKOUT
  // ============================================================
  function checkout() {
    if (cart.length === 0) return;

    let msg = `🛍️ *Nuevo Pedido — ${storeData.store}*\n\n`;

    cart.forEach(item => {
      msg += `${item.qty}x ${item.name} (Talle ${item.size}) — ${formatPrice(item.price * item.qty)}\n`;
    });

    msg += `\n*Total: ${formatPrice(getTotal())}*\n\n`;
    msg += `📱 Enviado desde la tienda online`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/${storeData.whatsapp}?text=${encoded}`, '_blank');
  }

  // ============================================================
  // GOOGLE SHEETS LOADER
  // ============================================================
  async function loadFromGoogleSheets(sheetId, tabName) {
    // Usa la API pública de Google Visualization para leer el Sheet como JSON
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;
    const res = await fetch(url);
    const text = await res.text();
    
    // Google devuelve JSONP: google.visualization.Query.setResponse({...})
    // Extraemos el JSON del medio
    const jsonStr = text.match(/google\.visualization\.Query\.setResponse\((.+)\)/);
    if (!jsonStr) throw new Error('No se pudo parsear respuesta de Google Sheets');
    
    const data = JSON.parse(jsonStr[1]);
    const cols = data.table.cols.map(c => c.label.toLowerCase().trim());
    const rows = data.table.rows;

    const products = [];
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].c;
      const get = (colName) => {
        const idx = cols.indexOf(colName);
        return idx >= 0 && cells[idx] ? (cells[idx].v || '') : '';
      };

      const active = get('activo');
      if (active === false || active === 'FALSE' || active === 'No') continue;

      const sizesRaw = get('talles') || get('sizes') || '';
      const sizes = sizesRaw ? sizesRaw.split(',').map(s => s.trim()).filter(Boolean) : ['Único'];

      // Foto URL puede ser múltiple (separado por coma) para carrusel
      const fotoRaw = get('foto url') || get('foto') || get('image') || get('imagen') || '';
      const imageUrls = fotoRaw.split(',').map(u => u.trim()).filter(Boolean);

      products.push({
        id: get('id') || (i + 1),
        name: get('nombre') || get('name') || '',
        description: get('descripción') || get('descripcion') || get('description') || '',
        category: get('categoría') || get('categoria') || get('category') || 'General',
        price: parseFloat(get('precio') || get('price') || 0),
        images: imageUrls.length > 0 ? imageUrls : undefined,
        image: imageUrls.length === 1 ? imageUrls[0] : (imageUrls[0] || ''),
        video: get('video url') || get('video') || '',
        sizes: sizes,
        active: true,
      });
    }

    // Extraer categorías únicas
    const categories = [...new Set(products.map(p => p.category))].filter(Boolean);

    return {
      store: document.title || 'Mi Tienda',
      whatsapp: document.querySelector('meta[name="whatsapp"]')?.content || 
                document.querySelector('[href*="wa.me"]')?.href?.match(/wa\.me\/(\d+)/)?.[1] || '',
      categories: categories,
      products: products,
    };
  }

  // ============================================================
  // SEARCH
  // ============================================================
  function searchProducts(query) {
    if (!storeData || !storeData.products) return;
    const q = query.toLowerCase().trim();
    const grid = document.getElementById('products-grid');
    if (!grid) return;

    if (!q) {
      renderProducts('all');
      return;
    }

    const filtered = storeData.products.filter(p => {
      if (!p.active && p.active !== undefined) return false;
      const searchText = [p.name, p.description, p.category, ...(p.sizes || [])].join(' ').toLowerCase();
      return q.split(/\s+/).every(word => searchText.includes(word));
    });

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="col-span-full text-center py-20 text-text-muted">
        <span class="material-symbols-outlined text-4xl mb-4 block">search_off</span>
        No se encontraron productos para "${query}"
      </div>`;
      return;
    }

    grid.innerHTML = filtered.map(p => renderProductCard(p)).join('');
  }

  // ============================================================
  // INIT — Carga desde Google Sheets o JSON local
  // ============================================================
  async function init() {
    try {
      // 1. Intentar obtener SHEET_ID dinámico desde Netlify Functions
      const metaStoreId = document.querySelector('meta[name="store-id"]');
      if (metaStoreId) {
        const storeId = metaStoreId.content;
        try {
          const cfgRes = await fetch(`/.netlify/functions/get-config?storeId=${storeId}`);
          if (cfgRes.ok) {
            const dynamicConfig = await cfgRes.json();
            if (dynamicConfig && dynamicConfig.SHEET_ID) {
              CONFIG.SHEET_ID = dynamicConfig.SHEET_ID;
              console.log('🔗 Conectado dinámicamente al Google Sheet:', CONFIG.SHEET_ID);
            }
          }
        } catch (err) {
          console.warn('⚠️ No se pudo obtener la config dinámica, usando local...', err);
        }
      }

      // 2. Cargar datos
      if (CONFIG.SHEET_ID) {
        console.log('📊 Cargando productos desde Google Sheets...');
        storeData = await loadFromGoogleSheets(CONFIG.SHEET_ID, CONFIG.SHEET_TAB);
        console.log(`✅ ${storeData.products.length} productos cargados desde Sheets`);
      } else {
        console.log('📄 Cargando productos desde JSON local...');
        const res = await fetch(CONFIG.LOCAL_JSON);
        storeData = await res.json();
        console.log(`✅ ${storeData.products.length} productos cargados desde JSON`);
      }
      renderProducts('all');
      updateBadge();
    } catch (e) {
      console.error('❌ Error cargando productos:', e);
      const grid = document.getElementById('products-grid');
      if (grid) grid.innerHTML = '<div class="col-span-full text-center py-20 text-red-400">Error cargando productos. Verificá la conexión.</div>';
    }
  }

  // Expose public API
  window._cart = {
    openSizeModal,
    closeSizeModal,
    addToCart,
    removeFromCart,
    changeQty,
    openCartDrawer,
    closeCartDrawer,
    checkout,
    filterCategory: renderProducts,
    searchProducts,
    openVideoModal,
    closeVideoModal,
    slideCarousel,
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
