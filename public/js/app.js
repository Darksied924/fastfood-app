// Main application initialization
document.addEventListener('DOMContentLoaded', () => {
    // Inject header and footer
    injectHeader();
    injectFooter();

    // Check if user is logged in and update UI
    updateNavigation();

    // Add animation to cards
    animateCards();

    // Handle modal clicks outside
    handleModalClicks();

    // Initialize tooltips
    initializeTooltips();
});

function injectHeader() {
    const header = document.querySelector('header');
    if (!header) return;

    const currentPath = window.location.pathname;
    const showBackButton = shouldShowBackButton(currentPath);

    header.innerHTML = `
        <div class="nav-container">
            <button class="nav-toggle" id="navToggle" aria-label="Toggle navigation" aria-expanded="false" aria-controls="mainNav">
                <span></span>
                <span></span>
                <span></span>
            </button>
            <a href="/" class="logo">Fast Food</a>
            <div class="nav-right">
                <button
                    class="back-nav-btn ${showBackButton ? '' : 'hidden'}"
                    id="backNavBtn"
                    type="button"
                    aria-label="Go back to previous page"
                >
                    ← Back
                </button>
                <nav class="nav-links">
                    <!-- Links will be injected by auth.js -->
                </nav>
                <div class="header-profile-slot" id="headerProfile"></div>
            </div>
        </div>
    `;

    initializeBackNavigation();
    initializeMobileNav();
}

function shouldShowBackButton(pathname) {
    const normalizedPath = pathname.replace(/\/+$/, '') || '/';
    const routesWithoutBackButton = new Set(['/', '/dashboard', '/delivery/dashboard']);

    if (routesWithoutBackButton.has(normalizedPath)) {
        return false;
    }

    return true;
}

function getBackFallbackPath(pathname) {
    if (pathname.startsWith('/admin/')) return '/dashboard';
    if (pathname.startsWith('/customer/')) return '/customer/menu';
    if (pathname.startsWith('/delivery/')) return '/delivery/dashboard';
    if (pathname === '/profile') return '/dashboard';
    if (pathname === '/forgot-password') return '/login';
    if (pathname.startsWith('/reset-password')) return '/login';
    if (pathname === '/login' || pathname === '/register') return '/';

    return '/dashboard';
}

function initializeBackNavigation() {
    const backButton = document.getElementById('backNavBtn');
    if (!backButton || backButton.classList.contains('hidden')) return;

    const fallbackPath = getBackFallbackPath(window.location.pathname);

    backButton.addEventListener('click', () => {
        const hasHistory = window.history.length > 1;
        const sameOriginReferrer = document.referrer && new URL(document.referrer).origin === window.location.origin;

        if (hasHistory && sameOriginReferrer) {
            window.history.back();
            return;
        }

        window.location.href = fallbackPath;
    });
}

function injectFooter() {
    const footer = document.querySelector('footer');
    if (!footer) return;

    footer.innerHTML = `
        <div class="footer-content">
            <p>&copy; ${new Date().getFullYear()} FastFood. All rights reserved.</p>
            <p>Delicious food delivered fast!</p>
        </div>
    `;
}

function animateCards() {
    const cards = document.querySelectorAll('.product-card, .feature-card, .dashboard-card');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    cards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(card);
    });
}

function handleModalClicks() {
    window.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    });
}

function initializeMobileNav() {
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.querySelector('.nav-links');

    if (!navToggle || !navLinks) return;

    navLinks.id = 'mainNav';
    navLinks.setAttribute('aria-hidden', 'true');

    const setMenuState = (isOpen) => {
        navLinks.classList.toggle('open', isOpen);
        navToggle.classList.toggle('open', isOpen);
        navToggle.setAttribute('aria-expanded', String(isOpen));
        navLinks.setAttribute('aria-hidden', String(!isOpen));
    };

    setMenuState(false);

    const closeMobileNav = () => {
        setMenuState(false);
    };

    navToggle.addEventListener('click', () => {
        const isOpen = !navLinks.classList.contains('open');
        setMenuState(isOpen);
    });

    navLinks.addEventListener('click', (event) => {
        if (event.target.tagName === 'A') {
            closeMobileNav();
        }
    });

    document.addEventListener('click', (event) => {
        const clickedInsideMenu = navLinks.contains(event.target);
        const clickedToggle = navToggle.contains(event.target);

        if (!clickedInsideMenu && !clickedToggle) {
            closeMobileNav();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeMobileNav();
        }
    });
}

// Initialize tooltips
function initializeTooltips() {
    const tooltipElements = document.querySelectorAll('[data-tooltip]');
    
    tooltipElements.forEach(element => {
        // Add tabindex for keyboard accessibility
        if (!element.hasAttribute('tabindex') && 
            !element.matches('a, button, input, select, textarea')) {
            element.setAttribute('tabindex', '0');
        }
        
        // Touch device support - show tooltip on touch
        element.addEventListener('touchstart', function(e) {
            // Prevent scrolling while showing tooltip
            e.preventDefault();
            
            // Hide any other open tooltips
            document.querySelectorAll('[data-tooltip].touch-active').forEach(el => {
                if (el !== element) {
                    el.classList.remove('touch-active');
                }
            });
            
            // Toggle tooltip visibility
            element.classList.toggle('touch-active');
        }, { passive: false });
    });
    
    // Hide tooltips when clicking elsewhere
    document.addEventListener('click', function(e) {
        if (!e.target.closest('[data-tooltip]')) {
            document.querySelectorAll('[data-tooltip].touch-active').forEach(el => {
                el.classList.remove('touch-active');
            });
        }
    });
    
    // Hide tooltips on scroll
    document.addEventListener('scroll', function() {
        document.querySelectorAll('[data-tooltip].touch-active').forEach(el => {
            el.classList.remove('touch-active');
        });
    }, { passive: true });
}

// Add CSS animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    
    .order-card {
        background: white;
        border-radius: var(--border-radius);
        padding: 1.5rem;
        margin-bottom: 1rem;
        box-shadow: var(--shadow);
        transition: all 0.3s ease;
    }
    
    .order-card:hover {
        transform: translateX(5px);
        box-shadow: var(--shadow-hover);
    }
    
    .order-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid var(--secondary-yellow);
    }
    
    .order-details {
        margin-bottom: 1rem;
    }
    
    .order-items {
        background: #f5f5f5;
        padding: 1rem;
        border-radius: 8px;
        margin-bottom: 1rem;
    }
    
    .order-item {
        display: flex;
        justify-content: space-between;
        padding: 0.3rem 0;
    }
    
    .user-greeting {
        color: white;
        font-weight: 500;
        margin-left: 1rem;
    }
    
    .btn-small {
        padding: 0.3rem 0.8rem;
        font-size: 0.85rem;
    }
    
    .remove-btn {
        background: var(--primary-red) !important;
    }
    
    .empty-cart {
        text-align: center;
        padding: 2rem;
        color: #999;
    }
`;

document.head.appendChild(style);
