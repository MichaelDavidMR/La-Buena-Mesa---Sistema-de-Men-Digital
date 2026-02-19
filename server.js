
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');

// Lowdb
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Config de sesiones
app.use(session({
    secret: 'restaurante-secret-session-' + crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Servir archivos estáticos PÚBLICOS 
app.use(express.static('public', {
    extensions: ['html'],
    index: false
}));

// Servir QR codes públicamente
app.use('/qrcodes', express.static('qrcodes'));

// Asegurar que existan carpetas
if (!fs.existsSync('qrcodes')) fs.mkdirSync('qrcodes');

// Base de datos JSON
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

// Datos por defecto
const defaultData = {
    products: [
        {
            id: 1,
            name: 'Ensalada César',
            description: 'Lechuga romana fresca, crutones, parmesano y aderezo césar casero',
            price: 8.50,
            category_id: 1,
            image: 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=400',
            available: true,
            options: [
                { name: 'Pollo extra', price: 3.00 },
                { name: 'Aguacate', price: 2.00 }
            ]
        },
        {
            id: 2,
            name: 'Hamburguesa Clásica',
            description: 'Carne de res 200g, queso cheddar, lechuga, tomate y salsa especial',
            price: 12.00,
            category_id: 2,
            image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400',
            available: true,
            options: [
                { name: 'Doble carne', price: 4.00 },
                { name: 'Bacon', price: 2.50 },
                { name: 'Huevo', price: 1.50 }
            ]
        },
        {
            id: 3,
            name: 'Pasta Alfredo',
            description: 'Fettuccine en salsa cremosa de parmesano con pollo grillé',
            price: 14.00,
            category_id: 2,
            image: 'https://images.unsplash.com/photo-1645112411341-6c4fd9367144?w=400',
            available: true,
            options: [
                { name: 'Camarones', price: 5.00 },
                { name: 'Champiñones', price: 2.00 }
            ]
        },
        {
            id: 4,
            name: 'Limonada Natural',
            description: 'Limones frescos, agua y azúcar al gusto',
            price: 3.50,
            category_id: 3,
            image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=400',
            available: true,
            options: [
                { name: 'Menta', price: 0.50 },
                { name: 'Jengibre', price: 0.50 }
            ]
        },
        {
            id: 5,
            name: 'Tiramisú',
            description: 'Clásico postre italiano con café y mascarpone',
            price: 6.50,
            category_id: 4,
            image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400',
            available: true,
            options: []
        }
    ],
    categories: [
        { id: 1, name: 'Entradas', icon: 'fa-utensils', color: 'bg-yellow-500' },
        { id: 2, name: 'Platos Principales', icon: 'fa-drumstick-bite', color: 'bg-red-500' },
        { id: 3, name: 'Bebidas', icon: 'fa-glass-martini', color: 'bg-blue-500' },
        { id: 4, name: 'Postres', icon: 'fa-ice-cream', color: 'bg-pink-500' }
    ],
    tables: [],
    orders: [],
    auditLogs: [],
    users: [
        {
            id: 1,
            username: 'admin',
            password: crypto.createHash('sha256').update('admin123').digest('hex'),
            role: 'admin',
            type: 'admin',
            createdAt: new Date().toISOString()
        },
        {
            id: 2,
            username: 'cocina',
            password: crypto.createHash('sha256').update('cocina123').digest('hex'),
            role: 'kitchen',
            type: 'kitchen',
            createdAt: new Date().toISOString()
        }
    ]
};

// Inicializar DB
async function initDb() {
    await db.read();
    
    if (!db.data || !db.data.products || !db.data.categories) {
        console.log('📦 Inicializando base de datos con datos por defecto...');
        db.data = defaultData;
        await db.write();
    } else {
        if (!db.data.users) {
            db.data.users = defaultData.users;
        } else {
            const hasKitchen = db.data.users.some(u => u.type === 'kitchen' || u.role === 'kitchen');
            const hasAdmin = db.data.users.some(u => u.type === 'admin' || u.role === 'admin');
            
            if (!hasKitchen) {
                db.data.users.push({
                    id: Date.now(),
                    username: 'cocina',
                    password: crypto.createHash('sha256').update('cocina123').digest('hex'),
                    role: 'kitchen',
                    type: 'kitchen',
                    createdAt: new Date().toISOString()
                });
            }
            if (!hasAdmin) {
                db.data.users.push(defaultData.users[0]);
            }
        }
        await db.write();
        console.log('📂 Base de datos cargada desde archivo existente');
    }
}

// Helpers
function generateTableCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function generateQRPayload(table) {
    const payload = {
        table_code: table.code,
        table_id: table.id,
        issued_at: new Date().toISOString(),
        expires_at: table.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        nonce: crypto.randomBytes(8).toString('hex'),
        version: '1.0'
    };
    
    const sig = crypto
        .createHmac('sha256', 'restaurante-secret-key')
        .update(JSON.stringify(payload))
        .digest('base64')
        .substring(0, 16);
    
    payload.sig = sig;
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function validateQRPayload(base64Payload) {
    try {
        const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
        const { sig, ...rest } = payload;
        
        const expectedSig = crypto
            .createHmac('sha256', 'restaurante-secret-key')
            .update(JSON.stringify(rest))
            .digest('base64')
            .substring(0, 16);
        
        if (sig !== expectedSig) {
            return { valid: false, error: 'Firma inválida' };
        }
        
        if (new Date(payload.expires_at) < new Date()) {
            return { valid: false, error: 'Código expirado' };
        }
        
        return { valid: true, data: payload };
    } catch (e) {
        return { valid: false, error: 'Formato inválido' };
    }
}

function addAuditLog(action, details, user = 'Sistema') {
    db.data.auditLogs.push({
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        user,
        action,
        details
    });
    db.write();
}

// ==========================================
// FUNCIONES AUXILIARES PARA REDIRECCIÓN SEGURA
// ==========================================

// Verifica si una URL es una página válida (no API)
function isValidPageUrl(url) {
    if (!url) return false;
    // No redirigir a URLs que contengan /api/
    if (url.includes('/api/')) return false;
    // No redirigir a archivos estáticos de sistema
    if (url.includes('.')) {
        // Solo permitir .html si es explícitamente eso
        const allowedExtensions = ['.html', '/'];
        const hasAllowed = allowedExtensions.some(ext => url.endsWith(ext));
        if (!hasAllowed) return false;
    }
    // Debe empezar con /
    if (!url.startsWith('/')) return false;
    return true;
}

// Obtiene redirección segura según el tipo de usuario
function getSafeRedirect(returnTo, userType) {
    // Si no hay returnTo o no es válido, usar default según tipo
    if (!isValidPageUrl(returnTo)) {
        return userType === 'admin' ? '/admin' : '/cocina';
    }
    
    // Si es admin, puede ir a cualquier página válida
    if (userType === 'admin') {
        return returnTo;
    }
    
    // Si es cocina, solo puede ir a cocina o páginas públicas
    if (userType === 'kitchen') {
        // No permitir acceso a admin
        if (returnTo.startsWith('/admin')) {
            return '/cocina';
        }
        return returnTo;
    }
    
    return '/';
}

// ==========================================
// MIDDLEWARE DE AUTENTICACIÓN ESPECÍFICO
// ==========================================

function requireAdmin(req, res, next) {
    if (req.session && req.session.authenticated && req.session.userType === 'admin') {
        return next();
    }
    // Solo guardar si es una página, no una API
    if (isValidPageUrl(req.originalUrl)) {
        req.session.returnTo = req.originalUrl;
    }
    res.redirect('/login');
}

function requireKitchen(req, res, next) {
    if (req.session && req.session.authenticated && 
        (req.session.userType === 'kitchen' || req.session.userType === 'admin')) {
        return next();
    }
    if (isValidPageUrl(req.originalUrl)) {
        req.session.returnTo = req.originalUrl;
    }
    res.redirect('/login-cocina');
}

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    if (isValidPageUrl(req.originalUrl)) {
        req.session.returnTo = req.originalUrl;
    }
    res.redirect('/login');
}

// ==========================================
// RUTAS DE AUTENTICACIÓN ADMIN
// ==========================================

app.get('/login', (req, res) => {
    if (req.session.authenticated && req.session.userType === 'admin') {
        return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const user = db.data.users.find(u => 
        u.username === username && 
        u.password === hashedPassword &&
        (u.type === 'admin' || u.role === 'admin')
    );
    
    if (!user) {
        addAuditLog('login_failed', `Intento fallido admin: ${username}`, 'Anónimo');
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.userType = 'admin';
    req.session.role = user.role;
    
    addAuditLog('login_success', `Admin ${username} inició sesión`, username);
    
    // Usar redirección segura
    const redirectTo = getSafeRedirect(req.session.returnTo, 'admin');
    delete req.session.returnTo;
    
    res.json({ success: true, redirect: redirectTo, type: 'admin' });
});

// ==========================================
// RUTAS DE AUTENTICACIÓN COCINA
// ==========================================

app.get('/login-cocina', (req, res) => {
    if (req.session.authenticated && 
        (req.session.userType === 'kitchen' || req.session.userType === 'admin')) {
        return res.redirect('/cocina');
    }
    res.sendFile(path.join(__dirname, 'public', 'login-cocina.html'));
});

app.post('/login-cocina', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const user = db.data.users.find(u => 
        u.username === username && 
        u.password === hashedPassword &&
        (u.type === 'kitchen' || u.role === 'kitchen' || u.type === 'admin' || u.role === 'admin')
    );
    
    if (!user) {
        addAuditLog('login_failed', `Intento fallido cocina: ${username}`, 'Anónimo');
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const userType = user.type || user.role;
    
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.userType = userType;
    req.session.role = user.role;
    
    addAuditLog('login_success', `Cocina/Admin ${username} inició sesión`, username);
    
    // Usar redirección segura según el tipo real del usuario
    const redirectTo = getSafeRedirect(req.session.returnTo, userType);
    delete req.session.returnTo;
    
    res.json({ success: true, redirect: redirectTo, type: userType });
});

// ==========================================
// LOGOUT UNIVERSAL
// ==========================================

app.post('/logout', (req, res) => {
    const username = req.session.username;
    const userType = req.session.userType;
    
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cerrar sesión' });
        }
        if (username) {
            addAuditLog('logout', `Usuario ${username} (${userType}) cerró sesión`, username);
        }
        res.json({ success: true });
    });
});

// ==========================================
// CHECK AUTH UNIVERSAL
// ==========================================

app.get('/api/check-auth', (req, res) => {
    res.json({
        authenticated: !!req.session.authenticated,
        userType: req.session.userType || null,
        user: req.session.authenticated ? {
            username: req.session.username,
            type: req.session.userType,
            role: req.session.role
        } : null
    });
});

// ==========================================
// RUTAS PROTEGIDAS - ADMIN ONLY
// ==========================================

app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin.html', requireAdmin, (req, res) => {
    res.redirect('/admin');
});

// ==========================================
// RUTAS PROTEGIDAS - COCINA (Y ADMIN)
// ==========================================

app.get('/cocina', requireKitchen, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cocina.html'));
});

app.get('/cocina.html', requireKitchen, (req, res) => {
    res.redirect('/cocina');
});

// ==========================================
// RUTAS PÚBLICAS
// ==========================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect('/');
});

// ==========================================
// API PÚBLICA
// ==========================================

app.get('/api/data', (req, res) => {
    res.json({
        products: db.data.products.filter(p => p.available),
        categories: db.data.categories,
        tables: db.data.tables.filter(t => t.status === 'active')
    });
});

app.post('/api/validate-qr', (req, res) => {
    const { payload } = req.body;
    const validation = validateQRPayload(payload);
    
    if (!validation.valid) {
        return res.status(400).json(validation);
    }
    
    const table = db.data.tables.find(t => t.code === validation.data.table_code);
    
    if (!table) {
        return res.status(404).json({ valid: false, error: 'Mesa no encontrada' });
    }
    
    if (table.status !== 'active') {
        return res.status(400).json({ valid: false, error: 'Mesa inactiva' });
    }
    
    res.json({ valid: true, table });
});

// ==========================================
// API PROTEGIDA - ADMIN ONLY
// ==========================================

app.get('/api/products', requireAdmin, (req, res) => {
    res.json(db.data.products);
});

app.post('/api/products', requireAdmin, async (req, res) => {
    const { name, description, price, category_id, image, options, available } = req.body;
    
    const newProduct = {
        id: Date.now(),
        name,
        description,
        price: parseFloat(price),
        category_id: parseInt(category_id),
        image,
        options: options || [],
        available: available !== undefined ? available : true
    };
    
    db.data.products.push(newProduct);
    await db.write();
    
    addAuditLog('product_create', `Producto creado: ${name}`, req.session.username);
    io.emit('product:updated', newProduct);
    
    res.json(newProduct);
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const idx = db.data.products.findIndex(p => p.id === id);
    
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    
    db.data.products[idx] = { ...db.data.products[idx], ...req.body, id };
    await db.write();
    
    addAuditLog('product_update', `Producto actualizado: ${req.body.name}`, req.session.username);
    io.emit('product:updated', db.data.products[idx]);
    
    res.json(db.data.products[idx]);
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const product = db.data.products.find(p => p.id === id);
    
    db.data.products = db.data.products.filter(p => p.id !== id);
    await db.write();
    
    addAuditLog('product_delete', `Producto eliminado: ${product?.name}`, req.session.username);
    io.emit('product:deleted', { id });
    
    res.json({ success: true });
});

app.get('/api/categories', requireAdmin, (req, res) => {
    res.json(db.data.categories);
});

app.post('/api/categories', requireAdmin, async (req, res) => {
    const newCategory = {
        id: Date.now(),
        name: req.body.name,
        icon: req.body.icon || 'fa-tag',
        color: req.body.color || 'bg-gray-500'
    };
    
    db.data.categories.push(newCategory);
    await db.write();
    
    addAuditLog('category_create', `Categoría creada: ${newCategory.name}`, req.session.username);
    res.json(newCategory);
});

app.put('/api/categories/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const idx = db.data.categories.findIndex(c => c.id === id);
    
    if (idx === -1) return res.status(404).json({ error: 'Categoría no encontrada' });
    
    db.data.categories[idx] = { ...db.data.categories[idx], ...req.body };
    await db.write();
    
    res.json(db.data.categories[idx]);
});

app.delete('/api/categories/:id', requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    db.data.categories = db.data.categories.filter(c => c.id !== id);
    await db.write();
    res.json({ success: true });
});

app.get('/api/tables', requireAdmin, (req, res) => {
    res.json(db.data.tables);
});

app.post('/api/tables', requireAdmin, async (req, res) => {
    const { code, is_temporary, note } = req.body;
    const finalCode = code ? code.toUpperCase() : generateTableCode();
    
    if (db.data.tables.find(t => t.code === finalCode)) {
        return res.status(400).json({ error: 'Código ya existe' });
    }
    
    const expiresAt = is_temporary 
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null;
    
    const table = {
        id: Date.now(),
        code: finalCode,
        status: 'active',
        note,
        createdAt: new Date().toISOString(),
        expiresAt
    };
    
    const qrPayload = generateQRPayload(table);
    const qrFilename = `table-${finalCode}.png`;
    const qrPath = path.join(__dirname, 'qrcodes', qrFilename);
    
    await QRCode.toFile(qrPath, qrPayload, {
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
    });
    
    table.qrPath = `/qrcodes/${qrFilename}`;
    table.qrPayload = qrPayload;
    
    db.data.tables.push(table);
    await db.write();
    
    addAuditLog('table_create', `Mesa creada: ${finalCode}${is_temporary ? ' (24h)' : ''}`, req.session.username);
    res.json(table);
});

app.patch('/api/tables/:code/status', requireAdmin, async (req, res) => {
    const { code } = req.params;
    const table = db.data.tables.find(t => t.code === code);
    
    if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
    
    table.status = req.body.status;
    await db.write();
    
    addAuditLog('table_status', `Mesa ${code} → ${req.body.status}`, req.session.username);
    res.json(table);
});

app.delete('/api/tables/:code', requireAdmin, async (req, res) => {
    const { code } = req.params;
    const table = db.data.tables.find(t => t.code === code);
    
    if (table?.qrPath) {
        const fullPath = path.join(__dirname, table.qrPath.replace('/qrcodes/', 'qrcodes/'));
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    
    db.data.tables = db.data.tables.filter(t => t.code !== code);
    await db.write();
    
    addAuditLog('table_delete', `Mesa eliminada: ${code}`, req.session.username);
    res.json({ success: true });
});

app.get('/api/logs', requireAdmin, (req, res) => {
    const logs = [...db.data.auditLogs].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    res.json(logs);
});

app.get('/api/export', requireAdmin, (req, res) => {
    res.json({
        products: db.data.products,
        categories: db.data.categories,
        tables: db.data.tables,
        exportedAt: new Date().toISOString()
    });
});

app.post('/api/import', requireAdmin, async (req, res) => {
    const { products, categories } = req.body;
    
    if (products) db.data.products = products;
    if (categories) db.data.categories = categories;
    
    await db.write();
    addAuditLog('import', 'Datos importados', req.session.username);
    
    io.emit('data:imported');
    res.json({ success: true });
});

// ==========================================
// API PROTEGIDA - COCINA (Y ADMIN)
// ==========================================

app.get('/api/orders', requireKitchen, (req, res) => {
    const orders = [...db.data.orders].sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
    );
    res.json(orders);
});

app.post('/api/orders', async (req, res) => {
    const { table_code, items, subtotal, tax, total, client_meta } = req.body;
    
    const table = db.data.tables.find(t => t.code === table_code);
    if (!table || table.status !== 'active') {
        return res.status(400).json({ error: 'Mesa no válida' });
    }
    
    const order = {
        id: Date.now(),
        table_code,
        table_id: table.id,
        items,
        subtotal,
        tax,
        total,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        client_meta
    };
    
    db.data.orders.push(order);
    await db.write();
    
    addAuditLog('order_create', `Pedido #${order.id} - Mesa ${table_code} - $${total}`, 'Cliente');
    
    io.to('kitchen').emit('order:new', order);
    io.to(`table:${table_code}`).emit('order:confirmed', { orderId: order.id, status: 'pending' });
    
    res.json(order);
});

app.patch('/api/orders/:id/status', requireKitchen, async (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    
    const order = db.data.orders.find(o => o.id === id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    
    order.status = status;
    order.updatedAt = new Date().toISOString();
    await db.write();
    
    addAuditLog('order_status', `Pedido #${id} → ${status}`, req.session.username);
    
    io.to(`table:${order.table_code}`).emit('order:status', { orderId: id, status });
    io.to('kitchen').emit('order:updated', { orderId: id, status });
    
    res.json(order);
});

// ==========================================
// WEBSOCKETS
// ==========================================

io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);
    
    socket.on('join:kitchen', () => {
        socket.join('kitchen');
        console.log(`Socket ${socket.id} unido a cocina`);
    });
    
    socket.on('join:table', (tableCode) => {
        socket.join(`table:${tableCode}`);
        console.log(`Socket ${socket.id} unido a mesa ${tableCode}`);
    });
    
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Iniciar
const PORT = process.env.PORT || 3000;

initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
        console.log(`📁 Base de datos: ${dbFile}`);
        console.log('');
        console.log(`🔐 Panel Admin: http://localhost:${PORT}/admin`);
        console.log(`   Login Admin: http://localhost:${PORT}/login`);
        console.log(`   Usuario: admin / Contraseña: admin123`);
        console.log('');
        console.log(`🍽️  Panel Cocina: http://localhost:${PORT}/cocina`);
        console.log(`   Login Cocina: http://localhost:${PORT}/login-cocina`);
        console.log(`   Usuario: cocina / Contraseña: cocina123`);
        console.log(`   (También puede usar admin/admin123)`);
    });
});