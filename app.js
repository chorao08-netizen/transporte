'use strict';

/**
 * TransportManager - App Logic
 * Pure JavaScript, SPA Architecture, SQLite Database (via Node.js API)
 */

// --- CONFIGURATION & CONSTANTS ---
const API_URL = 'http://localhost:3001/api';
const ENTITIES = {
    VEHICLES: 'vehicles',
    DRIVERS: 'drivers',
    ROUTES: 'routes',
    FUEL: 'fuel',
    PAYABLES: 'payables',
    RECEIVABLES: 'receivables',
    DRIVER_PAYMENTS: 'driver_payments',
    ADIANTAMENTOS: 'adiantamentos',
    DRIVER_ADJUSTMENTS: 'driver_adjustments',
    INVOICES: 'invoices',
    MAINTENANCE_LOGS: 'maintenance_logs'
};

const Auth = {
    tokenKey: 'tm_token',
    userKey: 'tm_user',
    getToken() {
        return localStorage.getItem(this.tokenKey) || '';
    },
    setSession(token, user) {
        localStorage.setItem(this.tokenKey, token);
        localStorage.setItem(this.userKey, JSON.stringify(user || null));
    },
    clear() {
        localStorage.removeItem(this.tokenKey);
        localStorage.removeItem(this.userKey);
    },
    getUser() {
        try { return JSON.parse(localStorage.getItem(this.userKey) || 'null'); } catch { return null; }
    },
    async status() {
        const r = await fetch(`${API_URL.replace('/api','')}/api/auth/status`);
        return await r.json();
    },
    async me() {
        const token = this.getToken();
        if (!token) return null;
        const r = await fetch(`${API_URL.replace('/api','')}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return null;
        const data = await r.json();
        this.setSession(token, data.user);
        return data.user;
    },
    async login(username, password) {
        const r = await fetch(`${API_URL.replace('/api','')}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Erro');
        this.setSession(data.token, data.user);
        return data.user;
    },
    async bootstrap(username, password) {
        const r = await fetch(`${API_URL.replace('/api','')}/api/auth/bootstrap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || 'Erro');
        this.setSession(data.token, data.user);
        return data.user;
    },
    async logout() {
        const token = this.getToken();
        if (token) {
            await fetch(`${API_URL.replace('/api','')}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        }
        this.clear();
    }
};

// --- DATABASE OBJECT (DB) ---
const DB = {
    cache: {},

    async init() {
        // No more localStorage migration - use SQLite exclusively
        await this.refreshAll();
    },

    async request(url, options = {}) {
        const token = Auth.getToken();
        const headers = { ...(options.headers || {}) };
        if (token) headers.Authorization = `Bearer ${token}`;
        const r = await fetch(url, { ...options, headers });
        if (r.status === 401) {
            Auth.clear();
            throw new Error('UNAUTHORIZED');
        }
        if (!r.ok) {
            let msg = 'Erro';
            try { msg = (await r.json())?.error || msg; } catch {}
            throw new Error(msg);
        }
        return r;
    },

    async refreshAll() {
        for (const key of Object.values(ENTITIES)) {
            const response = await this.request(`${API_URL}/${key}`);
            this.cache[key] = await response.json();
        }
    },

    getAll(key) {
        return this.cache[key] || [];
    },

    getById(key, id) {
        return this.getAll(key).find(item => item.id === id);
    },

    async save(key, item) {
        try {
            const response = await this.request(`${API_URL}/${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            const savedItem = await response.json();
            
            // Update cache
            const data = this.cache[key] || [];
            const index = data.findIndex(i => i.id === savedItem.id);
            if (index !== -1) {
                data[index] = savedItem;
            } else {
                data.push(savedItem);
            }
            return true;
        } catch (e) {
            console.error(`Error saving ${key}:`, e);
            if (String(e?.message || '') === 'UNAUTHORIZED') UI.navigate('login'); else UI.toast('Erro ao salvar no banco de dados', 'error');
            return false;
        }
    },

    async delete(key, id) {
        try {
            await this.request(`${API_URL}/${key}/${id}`, { method: 'DELETE' });
            this.cache[key] = this.cache[key].filter(item => item.id !== id);
            return true;
        } catch (e) {
            console.error(`Error deleting ${key}:`, e);
            if (String(e?.message || '') === 'UNAUTHORIZED') UI.navigate('login'); else UI.toast('Erro ao excluir do banco de dados', 'error');
            return false;
        }
    }
};

// --- UTILITIES ---
const Utils = {
    formatCurrency(value) {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    monthKey(dateStr) {
        return (dateStr || '').slice(0, 7);
    },
    makeMonthKey(year, month) {
        return `${year}-${String(month).padStart(2, '0')}`;
    },
    lastDayOfMonth(year, month) {
        return new Date(year, month, 0).getDate();
    },
    isSunday(dateStr) {
        if (!dateStr) return false;
        const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
        if (!y || !m || !d) return false;
        return new Date(y, m - 1, d).getDay() === 0;
    },
    getSundayRate(driver) {
        const raw = parseFloat(driver?.valorDomingo || 0);
        if (raw > 0) return raw;
        const name = String(driver?.nome || '').trim().toLowerCase();
        if (name.includes('lucas')) return 120;
        if (name.includes('henrrique') || name.includes('henrique')) return 115;
        return 0;
    },
    formatDate(dateStr) {
        if (!dateStr) return '-';
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    },
    formatFullDate(date) {
        return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(date);
    },
    getMonthName(monthIndex) {
        const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        return months[monthIndex];
    },
    getRelativeTime(date) {
        const diff = new Date() - new Date(date);
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) return 'Hoje';
        if (days === 1) return 'Ontem';
        return `Há ${days} dias`;
    },
    groupSumBy(data, keyField, valueField) {
        return data.reduce((acc, curr) => {
            const key = curr[keyField];
            acc[key] = (acc[key] || 0) + parseFloat(curr[valueField] || 0);
            return acc;
        }, {});
    },
    async exportToPDF(title, headers, rows, filename) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text(title, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Gerado em: ${new Date().toLocaleString()}`, 14, 30);
        
        doc.autoTable({
            head: [headers],
            body: rows,
            startY: 35,
            theme: 'grid',
            headStyles: { fillColor: [30, 41, 59] },
            alternateRowStyles: { fillColor: [248, 250, 252] }
        });
        
        doc.save(`${filename}.pdf`);
    },
    async fetchGPSData() {
        UI.toast('Buscando dados do GPS...', 'info');
        // Simulando delay de rede e retorno de API de GPS
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const mocks = [
            { origem: 'Santos/SP', destino: 'São Paulo/SP', km: 85 },
            { origem: 'Curitiba/PR', destino: 'Joinville/SC', km: 130 },
            { origem: 'Rio de Janeiro/RJ', destino: 'Vitória/ES', km: 520 },
            { origem: 'Campinas/SP', destino: 'Ribeirão Preto/SP', km: 220 }
        ];
        
        const data = mocks[Math.floor(Math.random() * mocks.length)];
        UI.toast('Dados do GPS importados!', 'success');
        return data;
    }
};

// --- UI CONTROLLER ---
const UI = {
    currentPage: 'dashboard',
    
    async init() {
        this.updateDate();
        this.setupEventListeners();
        let user = null;
        try {
            user = await Auth.me();
        } catch (e) {
            user = null;
        }
        if (!user) {
            this.navigate('login');
            return;
        }
        const backupBtn = document.getElementById('backup-btn');
        const navAdmin = document.getElementById('nav-admin');
        if (backupBtn) {
            if (user.role !== 'admin') backupBtn.classList.add('hidden');
            backupBtn.addEventListener('click', () => {
                window.location.href = `${API_URL}/backup`;
            });
        }
        if (navAdmin) {
            if (user.role !== 'admin') navAdmin.classList.add('hidden'); else navAdmin.classList.remove('hidden');
        }
        try {
            await DB.init();
        } catch (e) {
            if (String(e?.message || '') === 'UNAUTHORIZED') {
                this.navigate('login');
                return;
            }
            UI.toast('Erro ao conectar com o servidor', 'error');
        }
        const hash = window.location.hash.replace('#', '');
        this.navigate(hash || 'dashboard');
    },

    updateDate() {
        const dateEl = document.getElementById('current-date');
        if (dateEl) dateEl.textContent = Utils.formatFullDate(new Date());
    },

    setupEventListeners() {
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'modal-overlay') this.closeModal();
        });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });
    },

    navigate(page) {
        this.currentPage = page;
        window.location.hash = page;
        
        document.querySelectorAll('.sidebar-link').forEach(link => {
            link.classList.remove('active');
            if (link.id === `nav-${page}`) link.classList.add('active');
        });

        const titleMap = {
            login: 'Acesso',
            dashboard: 'Dashboard',
            vehicles: 'Frota de Veículos',
            drivers: 'Cadastro de Motoristas',
            routes: 'Rotas e Viagens',
            fuel: 'Controle de Combustível',
            finance: 'Gestão Financeira',
            payments: 'Pagamentos de Motoristas',
            invoices: 'Central de Notas Fiscais',
            maintenance: 'Histórico de Manutenções',
            admin: 'Administração',
            reports: 'Relatórios Gerenciais'
        };

        document.getElementById('page-title').textContent = titleMap[page] || 'TransportManager';
        this.renderPage(page);
    },

    renderPage(page) {
        const container = document.getElementById('pages-container');
        container.innerHTML = `<div id="page-${page}" class="animate-in fade-in duration-500"></div>`;
        if (Pages[page]) {
            Pages[page].render();
        } else {
            container.innerHTML = `<div class="p-12 text-center text-slate-400">Página em construção...</div>`;
        }
    },

    openModal(title, contentHtml, footerHtml = '') {
        const modal = document.getElementById('modal-overlay');
        const modalContent = document.getElementById('modal-content');
        
        modalContent.innerHTML = `
            <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 class="text-lg font-bold text-slate-800">${title}</h3>
                <button onclick="UI.closeModal()" class="text-slate-400 hover:text-slate-600 transition-colors">
                    <i class="fa-solid fa-xmark text-xl"></i>
                </button>
            </div>
            <div class="p-6 max-h-[75vh] overflow-y-auto">
                ${contentHtml}
            </div>
            ${footerHtml ? `<div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">${footerHtml}</div>` : ''}
        `;
        
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    closeModal() {
        const modal = document.getElementById('modal-overlay');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    },

    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        const colors = { success: 'bg-emerald-500', error: 'bg-rose-500', info: 'bg-blue-600', warning: 'bg-amber-500' };
        const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };

        toast.className = `${colors[type]} text-white px-5 py-3 rounded-xl shadow-lg flex items-center gap-3 min-w-[280px] animate-in slide-in-from-right-full duration-300`;
        toast.innerHTML = `
            <i class="fa-solid ${icons[type]} text-xl"></i>
            <span class="font-medium flex-1">${message}</span>
            <button onclick="this.parentElement.remove()" class="opacity-70 hover:opacity-100"><i class="fa-solid fa-xmark"></i></button>
        `;
        
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('animate-out', 'slide-out-to-right-full', 'fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }
};

// --- PAGE RENDERERS ---
const Pages = {
    login: {
        render() {
            const container = document.getElementById('page-login');
            container.innerHTML = `
                <div class="max-w-md mx-auto mt-16 bg-white border border-slate-100 rounded-2xl shadow-sm p-8">
                    <h3 class="text-xl font-bold text-slate-800 mb-2">Acesso</h3>
                    <p class="text-slate-500 text-sm mb-6">Entre com seu usuário e senha.</p>
                    <div id="login-mode" class="space-y-4"></div>
                </div>
            `;
            this.loadMode();
        },
        async loadMode() {
            const modeEl = document.getElementById('login-mode');
            if (!modeEl) return;
            try {
                const status = await Auth.status();
                if (!status.hasUsers) {
                    modeEl.innerHTML = `
                        <div class="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded-lg">
                            Primeiro acesso: crie o usuário administrador.
                        </div>
                        <form id="form-bootstrap" class="space-y-4">
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Usuário</label><input name="username" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Senha</label><input type="password" name="password" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <button type="button" onclick="Pages.login.bootstrap()" class="w-full bg-blue-600 text-white font-bold py-2.5 rounded-lg">Criar Admin</button>
                        </form>
                    `;
                } else {
                    modeEl.innerHTML = `
                        <form id="form-login" class="space-y-4">
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Usuário</label><input name="username" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Senha</label><input type="password" name="password" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <button type="button" onclick="Pages.login.doLogin()" class="w-full bg-blue-600 text-white font-bold py-2.5 rounded-lg">Entrar</button>
                        </form>
                    `;
                }
            } catch (e) {
                modeEl.innerHTML = `<div class="text-rose-600 text-sm">Erro ao conectar no servidor.</div>`;
            }
        },
        async doLogin() {
            const form = document.getElementById('form-login');
            if (!form) return;
            try {
                const user = await Auth.login(form.username.value, form.password.value);
                const backupBtn = document.getElementById('backup-btn');
                if (backupBtn) {
                    if (user.role !== 'admin') backupBtn.classList.add('hidden'); else backupBtn.classList.remove('hidden');
                }
                await DB.init();
                UI.navigate('dashboard');
            } catch (e) {
                UI.toast('Usuário ou senha inválidos', 'error');
            }
        },
        async bootstrap() {
            const form = document.getElementById('form-bootstrap');
            if (!form) return;
            try {
                const user = await Auth.bootstrap(form.username.value, form.password.value);
                const backupBtn = document.getElementById('backup-btn');
                if (backupBtn) backupBtn.classList.remove('hidden');
                await DB.init();
                UI.navigate('dashboard');
            } catch (e) {
                UI.toast('Erro ao criar admin', 'error');
            }
        }
    },
    admin: {
        tab: 'users',
        render() {
            const user = Auth.getUser();
            const container = document.getElementById('page-admin');
            if (!user || user.role !== 'admin') {
                container.innerHTML = `<div class="p-12 text-center text-slate-400">Sem permissão.</div>`;
                return;
            }
            container.innerHTML = `
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                    <div>
                        <h3 class="text-xl font-bold text-slate-800">Administração</h3>
                        <p class="text-slate-500 text-sm">Usuários, auditoria e saúde do servidor</p>
                    </div>
                    <div class="flex gap-1 bg-slate-100 p-1 rounded-lg">
                        <button onclick="Pages.admin.setTab('users')" class="px-4 py-1 text-xs font-bold rounded-md ${this.tab==='users'?'bg-white text-blue-600 shadow-sm':'text-slate-500'}">Usuários</button>
                        <button onclick="Pages.admin.setTab('audit')" class="px-4 py-1 text-xs font-bold rounded-md ${this.tab==='audit'?'bg-white text-blue-600 shadow-sm':'text-slate-500'}">Auditoria</button>
                        <button onclick="Pages.admin.setTab('health')" class="px-4 py-1 text-xs font-bold rounded-md ${this.tab==='health'?'bg-white text-blue-600 shadow-sm':'text-slate-500'}">Saúde</button>
                    </div>
                </div>
                <div id="admin-body"></div>
            `;
            if (this.tab === 'users') this.renderUsers();
            if (this.tab === 'audit') this.renderAudit();
            if (this.tab === 'health') this.renderHealth();
        },
        setTab(tab) {
            this.tab = tab;
            this.render();
        },
        async api(path, options) {
            const base = API_URL.replace('/api', '');
            const r = await DB.request(`${base}${path}`, options);
            return await r.json();
        },
        renderUsers() {
            const body = document.getElementById('admin-body');
            body.innerHTML = `
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                        <h4 class="font-bold text-slate-800 mb-4">Criar Usuário</h4>
                        <form id="form-admin-user" class="space-y-4">
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Usuário</label><input name="username" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Senha</label><input type="password" name="password" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Perfil</label>
                                <select name="role" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                                    <option value="operacional">Operacional</option>
                                    <option value="financeiro">Financeiro</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                            <button type="button" onclick="Pages.admin.createUser()" class="w-full bg-blue-600 text-white font-bold py-2.5 rounded-lg">Criar</button>
                        </form>
                    </div>
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                        <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h4 class="font-bold text-slate-800">Usuários</h4>
                            <button onclick="Pages.admin.loadUsers()" class="text-xs font-bold text-blue-600">Atualizar</button>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-sm">
                                <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                                    <tr><th class="px-6 py-4">Usuário</th><th class="px-6 py-4">Perfil</th><th class="px-6 py-4 text-center">Ativo</th><th class="px-6 py-4 text-center">Ações</th></tr>
                                </thead>
                                <tbody id="admin-users-body" class="divide-y divide-slate-100">
                                    <tr><td colspan="4" class="px-6 py-8 text-center text-slate-400">Carregando...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
            this.loadUsers();
        },
        async loadUsers() {
            const tbody = document.getElementById('admin-users-body');
            if (!tbody) return;
            try {
                const users = await this.api('/api/admin/users');
                tbody.innerHTML = users.map(u => `
                    <tr>
                        <td class="px-6 py-4 font-bold text-slate-700">${u.username}</td>
                        <td class="px-6 py-4">
                            <select onchange="Pages.admin.updateUser('${u.id}', { role: this.value })" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
                                ${['operacional','financeiro','admin'].map(r => `<option value="${r}" ${u.role===r?'selected':''}>${r}</option>`).join('')}
                            </select>
                        </td>
                        <td class="px-6 py-4 text-center">
                            <input type="checkbox" ${u.active ? 'checked' : ''} onchange="Pages.admin.updateUser('${u.id}', { active: this.checked ? 1 : 0 })">
                        </td>
                        <td class="px-6 py-4 text-center">
                            <button onclick="Pages.admin.resetPassword('${u.id}')" class="p-2 text-slate-400 hover:text-blue-600"><i class="fa-solid fa-key"></i></button>
                        </td>
                    </tr>
                `).join('') || `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-400">Sem usuários</td></tr>`;
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-rose-600">Erro ao carregar</td></tr>`;
            }
        },
        async createUser() {
            const form = document.getElementById('form-admin-user');
            if (!form) return;
            try {
                await this.api('/api/admin/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: form.username.value, password: form.password.value, role: form.role.value })
                });
                UI.toast('Usuário criado', 'success');
                form.reset();
                this.loadUsers();
            } catch (e) {
                UI.toast('Erro ao criar usuário', 'error');
            }
        },
        async updateUser(id, patch) {
            try {
                await this.api(`/api/admin/users/${id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patch)
                });
                UI.toast('Atualizado', 'success');
            } catch (e) {
                UI.toast('Erro ao atualizar', 'error');
            }
        },
        async resetPassword(id) {
            const pwd = prompt('Nova senha:');
            if (!pwd) return;
            await this.updateUser(id, { password: pwd });
        },
        renderAudit() {
            const body = document.getElementById('admin-body');
            body.innerHTML = `
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h4 class="font-bold text-slate-800">Auditoria</h4>
                        <button onclick="Pages.admin.loadAudit()" class="text-xs font-bold text-blue-600">Atualizar</button>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-sm">
                            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                                <tr><th class="px-6 py-4">Quando</th><th class="px-6 py-4">Usuário</th><th class="px-6 py-4">Ação</th><th class="px-6 py-4">Entidade</th><th class="px-6 py-4">ID</th></tr>
                            </thead>
                            <tbody id="admin-audit-body" class="divide-y divide-slate-100">
                                <tr><td colspan="5" class="px-6 py-8 text-center text-slate-400">Carregando...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            this.loadAudit();
        },
        async loadAudit() {
            const tbody = document.getElementById('admin-audit-body');
            if (!tbody) return;
            try {
                const rows = await this.api('/api/admin/audit?limit=200');
                tbody.innerHTML = rows.map(r => `
                    <tr>
                        <td class="px-6 py-4 text-xs text-slate-600">${new Date(r.ts).toLocaleString()}</td>
                        <td class="px-6 py-4 font-bold text-slate-700">${r.username || '-'}</td>
                        <td class="px-6 py-4 text-xs">${r.action}</td>
                        <td class="px-6 py-4 text-xs">${r.entity}</td>
                        <td class="px-6 py-4 text-xs font-mono">${r.entityId || '-'}</td>
                    </tr>
                `).join('') || `<tr><td colspan="5" class="px-6 py-8 text-center text-slate-400">Sem registros</td></tr>`;
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-rose-600">Erro ao carregar</td></tr>`;
            }
        },
        renderHealth() {
            const body = document.getElementById('admin-body');
            body.innerHTML = `
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                    <h4 class="font-bold text-slate-800 mb-2">Saúde do Servidor</h4>
                    <div id="admin-health" class="text-slate-500 text-sm">Carregando...</div>
                </div>
            `;
            this.loadHealth();
        },
        async loadHealth() {
            const el = document.getElementById('admin-health');
            if (!el) return;
            try {
                const base = API_URL.replace('/api', '');
                const r = await fetch(`${base}/api/health`);
                const data = await r.json();
                el.innerHTML = data.ok ? `<span class="text-emerald-600 font-bold">OK</span> • ${new Date(data.time).toLocaleString()}` : `<span class="text-rose-600 font-bold">Erro</span>`;
            } catch (e) {
                el.innerHTML = `<span class="text-rose-600 font-bold">Erro</span>`;
            }
        }
    },
    dashboard: {
        selectedMonth: null,
        render() {
            const vehicles = DB.getAll(ENTITIES.VEHICLES);
            const routes = DB.getAll(ENTITIES.ROUTES);
            const fuel = DB.getAll(ENTITIES.FUEL);
            const payables = DB.getAll(ENTITIES.PAYABLES);
            const receivables = DB.getAll(ENTITIES.RECEIVABLES);
            
            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();
            const currentMonthKey = Utils.makeMonthKey(currentYear, currentMonth);
            const monthKey = this.selectedMonth || currentMonthKey;
            
            const monthRoutes = routes.filter(r => Utils.monthKey(r.data) === monthKey);
            const monthFuel = fuel.filter(f => Utils.monthKey(f.data) === monthKey);

            const totalRevenue = monthRoutes.reduce((acc, r) => acc + parseFloat(r.valorFrete || 0), 0);
            const totalFuelExp = monthFuel.reduce((acc, f) => acc + parseFloat(f.valorTotal || 0), 0);
            const pendingPayables = payables.filter(p => p.status === 'pendente').reduce((acc, p) => acc + parseFloat(p.valor || 0), 0);
            const pendingReceivables = receivables.filter(r => r.status === 'pendente').reduce((acc, r) => acc + parseFloat(r.valor || 0), 0);
            const totalKm = monthRoutes.reduce((acc, r) => acc + parseFloat(r.km || 0), 0);
            const costPerKm = totalKm > 0 ? totalFuelExp / totalKm : 0;

            // Alertas de Manutenção
            const allAlerts = [];
            vehicles.forEach(v => {
                const kmRevisao = v.kmAtual - (v.kmUltimaManutencao || 0);
                const kmOleo = v.kmAtual - (v.kmTrocaOleo || 0);
                const kmPneus = v.kmAtual - (v.kmTrocaPneus || 0);
                
                if (kmRevisao >= (v.kmProximaManutencao || 10000)) {
                    allAlerts.push({ veiculo: v.placa, tipo: 'Revisão Geral', kmFaltando: kmRevisao - (v.kmProximaManutencao || 10000) });
                }
                if (kmOleo >= (v.kmProximoOleo || 10000)) {
                    allAlerts.push({ veiculo: v.placa, tipo: 'Troca de Óleo', kmFaltando: kmOleo - (v.kmProximoOleo || 10000) });
                }
                if (kmPneus >= (v.kmProximoPneus || 40000)) {
                    allAlerts.push({ veiculo: v.placa, tipo: 'Troca de Pneus', kmFaltando: kmPneus - (v.kmProximoPneus || 40000) });
                }
            });

            const container = document.getElementById('page-dashboard');
            container.innerHTML = `
                ${allAlerts.length > 0 ? `
                <div class="mb-8 bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-sm">
                    <div class="flex items-start gap-3">
                        <i class="fa-solid fa-triangle-exclamation text-amber-600 text-2xl mt-0.5"></i>
                        <div class="flex-1">
                            <h4 class="font-bold text-amber-800 text-sm mb-2">${allAlerts.length} ${allAlerts.length > 1 ? 'Alertas de Manutenção' : 'Alerta de Manutenção'} Necessário!</h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                ${allAlerts.map(al => `
                                    <div class="bg-white p-2 rounded-lg border border-amber-200 flex items-center justify-between">
                                        <div>
                                            <span class="font-bold text-amber-900 text-xs">${al.veiculo}</span>
                                            <span class="text-amber-700 text-[10px] ml-2">${al.tipo}</span>
                                        </div>
                                        <span class="text-amber-600 text-[10px] font-bold">${Math.abs(al.kmFaltando).toLocaleString()} km</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <button onclick="navigate('vehicles')" class="ml-auto bg-amber-600 text-white px-3 py-1 rounded-lg text-[10px] font-bold uppercase">Ver Frota</button>
                    </div>
                </div>
                ` : ''}

                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div>
                        <h3 class="text-lg font-bold text-slate-800">Resumo do Mês</h3>
                        <p class="text-slate-500 text-xs">${Utils.getMonthName(parseInt(monthKey.slice(5, 7), 10) - 1)} / ${monthKey.slice(0, 4)}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <input type="month" value="${monthKey}" onchange="Pages.dashboard.selectedMonth=this.value; Pages.dashboard.render()" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none">
                        <button onclick="Pages.dashboard.selectedMonth=null; Pages.dashboard.render()" class="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold uppercase">Atual</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div class="card-kpi border-blue-500">
                        <div class="flex justify-between items-start">
                            <div><p class="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Receita Fretes</p><h3 class="text-2xl font-bold text-slate-800">${Utils.formatCurrency(totalRevenue)}</h3></div>
                            <div class="p-2 bg-blue-50 text-blue-500 rounded-lg"><i class="fa-solid fa-money-bill-trend-up"></i></div>
                        </div>
                    </div>
                    <div class="card-kpi border-rose-500">
                        <div class="flex justify-between items-start">
                            <div><p class="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Despesas Combustível</p><h3 class="text-2xl font-bold text-slate-800">${Utils.formatCurrency(totalFuelExp)}</h3></div>
                            <div class="p-2 bg-rose-50 text-rose-500 rounded-lg"><i class="fa-solid fa-gas-pump"></i></div>
                        </div>
                    </div>
                    <div class="card-kpi border-emerald-500">
                        <div class="flex justify-between items-start">
                            <div><p class="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Resultado Líquido</p><h3 class="text-2xl font-bold text-slate-800">${Utils.formatCurrency(totalRevenue - totalFuelExp)}</h3></div>
                            <div class="p-2 bg-emerald-50 text-emerald-500 rounded-lg"><i class="fa-solid fa-scale-balanced"></i></div>
                        </div>
                    </div>
                    <div class="card-kpi border-amber-500">
                        <div class="flex justify-between items-start">
                            <div><p class="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Km Rodados (Mês)</p><h3 class="text-2xl font-bold text-slate-800">${totalKm.toLocaleString()} km</h3></div>
                            <div class="p-2 bg-amber-50 text-amber-500 rounded-lg"><i class="fa-solid fa-road"></i></div>
                        </div>
                    </div>
                </div>

                <!-- Novo Dashboard de Consumo Diário -->
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8">
                    <div class="flex justify-between items-center mb-6">
                        <h4 class="font-bold text-slate-800">Consumo Médio por Veículo (km/L)</h4>
                        <span class="text-xs text-slate-400 font-medium italic">Baseado em abastecimentos e rotas do mês</span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        ${vehicles.map(v => {
                            const vFuel = monthFuel.filter(f => f.veiculoId === v.id).reduce((acc, f) => acc + parseFloat(f.litros || 0), 0);
                            const vKm = monthRoutes.filter(r => r.veiculoId === v.id).reduce((acc, r) => acc + parseFloat(r.km || 0), 0);
                            const avg = vFuel > 0 ? (vKm / vFuel).toFixed(2) : '0.00';
                            return `
                                <div class="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <p class="text-[10px] font-black text-slate-400 uppercase mb-1">${v.placa}</p>
                                    <div class="flex items-end gap-2">
                                        <span class="text-xl font-bold text-slate-700">${avg}</span>
                                        <span class="text-xs text-slate-500 mb-1">km/L</span>
                                    </div>
                                    <div class="mt-2 w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                        <div class="bg-blue-500 h-full" style="width: ${Math.min(parseFloat(avg) * 10, 100)}%"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><h4 class="font-bold text-slate-800 mb-4">Receita vs Despesas (Últimos 6 meses)</h4><div class="h-64"><canvas id="chart-revenue-expenses"></canvas></div></div>
                    <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100"><h4 class="font-bold text-slate-800 mb-4">Combustível por Veículo (Mês Atual)</h4><div class="h-64"><canvas id="chart-fuel-vehicle"></canvas></div></div>
                </div>

                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center"><h4 class="font-bold text-slate-800">Últimas 10 Rotas</h4><button onclick="navigate('routes')" class="text-blue-600 text-sm font-semibold hover:underline">Ver todas</button></div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-sm">
                            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                                <tr><th class="px-6 py-3">Data</th><th class="px-6 py-3">Motorista</th><th class="px-6 py-3">Veículo</th><th class="px-6 py-3">Destino</th><th class="px-6 py-3 text-right">Km</th><th class="px-6 py-3 text-right">Frete</th></tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${routes.sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 10).map(r => {
                                    const driver = DB.getById(ENTITIES.DRIVERS, r.motoristaId);
                                    const vehicle = DB.getById(ENTITIES.VEHICLES, r.veiculoId);
                                    return `
                                        <tr class="hover:bg-slate-50 transition-colors">
                                            <td class="px-6 py-4 whitespace-nowrap">${Utils.formatDate(r.data)}</td>
                                            <td class="px-6 py-4 font-medium text-slate-700">${driver ? driver.nome : 'N/A'}</td>
                                            <td class="px-6 py-4"><span class="bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono text-xs">${vehicle ? vehicle.placa : 'N/A'}</span></td>
                                            <td class="px-6 py-4">${r.destino}</td>
                                            <td class="px-6 py-4 text-right">${r.km} km</td>
                                            <td class="px-6 py-4 text-right font-bold text-emerald-600">${Utils.formatCurrency(r.valorFrete)}</td>
                                        </tr>
                                    `;
                                }).join('') || '<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Nenhuma rota registrada recentemente</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            this.initCharts(routes, fuel, monthKey);
        },
        initCharts(routes, fuel, baseMonthKey) {
            const ctx1 = document.getElementById('chart-revenue-expenses');
            if (ctx1) {
                const baseDate = new Date(`${baseMonthKey}-15T12:00:00`);
                const last6Months = [];
                for (let i = 5; i >= 0; i--) {
                    const d = new Date(baseDate); d.setMonth(d.getMonth() - i);
                    const month = d.getMonth() + 1;
                    const year = d.getFullYear();
                    last6Months.push({ month, year, key: Utils.makeMonthKey(year, month), label: Utils.getMonthName(d.getMonth()) });
                }
                const revData = last6Months.map(m => routes.filter(r => Utils.monthKey(r.data) === m.key).reduce((acc, curr) => acc + parseFloat(curr.valorFrete || 0), 0));
                const expData = last6Months.map(m => fuel.filter(f => Utils.monthKey(f.data) === m.key).reduce((acc, curr) => acc + parseFloat(curr.valorTotal || 0), 0));
                new Chart(ctx1, { type: 'bar', data: { labels: last6Months.map(m => m.label), datasets: [{ label: 'Receita', data: revData, backgroundColor: '#3b82f6', borderRadius: 6 }, { label: 'Despesa', data: expData, backgroundColor: '#f43f5e', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => Utils.formatCurrency(v) } } } } });
            }
            const ctx2 = document.getElementById('chart-fuel-vehicle');
            if (ctx2) {
                const monthFuel = fuel.filter(f => Utils.monthKey(f.data) === baseMonthKey);
                const grouped = Utils.groupSumBy(monthFuel, 'veiculoId', 'valorTotal');
                const labels = [], data = [];
                Object.entries(grouped).forEach(([vId, total]) => { const v = DB.getById(ENTITIES.VEHICLES, vId); labels.push(v ? v.placa : 'N/A'); data.push(total); });
                new Chart(ctx2, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } }, cutout: '70%' } });
            }
        }
    },
    vehicles: {
        render() {
            const list = DB.getAll(ENTITIES.VEHICLES);
            const container = document.getElementById('page-vehicles');
            container.innerHTML = `
                <div class="flex justify-between items-center mb-8"><div><h3 class="text-xl font-bold text-slate-800">Frota</h3><p class="text-slate-500 text-sm">${list.length} veículos cadastrados</p></div><button onclick="Pages.vehicles.openForm()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg"><i class="fa-solid fa-plus"></i> Novo Veículo</button></div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${list.map(v => {
                        const icon = {'Caminhão': '🚚', 'Utilitário': '🛻', 'Van': '🚐', 'Carro': '🚗', 'Moto': '🏍️'}[v.tipo] || '🚗';
                        return `
                            <div class="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition-all relative overflow-hidden">
                                <div class="absolute top-0 right-0 p-3"><span class="${v.ativo ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'} text-[10px] font-bold uppercase px-2 py-1 rounded-full">${v.ativo ? 'Ativo' : 'Inativo'}</span></div>
                                <div class="flex items-center gap-4 mb-4"><div class="text-4xl grayscale-[0.5]">${icon}</div><div><div class="bg-slate-800 text-white font-mono text-xl px-3 py-0.5 rounded border-2 border-slate-700 shadow-sm">${v.placa.toUpperCase()}</div><h4 class="font-bold text-slate-700 mt-1">${v.modelo}</h4></div></div>
                                <div class="grid grid-cols-2 gap-4 mb-6 text-sm"><div><span class="text-slate-400 text-[10px] font-bold uppercase">Tipo / Comb.</span><span class="block text-slate-600 font-medium">${v.tipo} / ${v.combustivel}</span></div><div><span class="text-slate-400 text-[10px] font-bold uppercase">KM Atual</span><span class="block text-slate-600 font-bold">${v.kmAtual.toLocaleString()} km</span></div></div>
                                
                                <div class="mb-6 p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
                                    <div>
                                        <div class="flex justify-between items-center mb-1">
                                            <span class="text-[10px] font-bold text-slate-400 uppercase">Revisão Geral</span>
                                            <span class="text-[10px] font-bold ${((v.kmAtual - (v.kmUltimaManutencao || 0)) >= (v.kmProximaManutencao || 10000)) ? 'text-rose-500' : 'text-emerald-500'}">
                                                ${((v.kmAtual - (v.kmUltimaManutencao || 0)) >= (v.kmProximaManutencao || 10000)) ? 'Urgente' : 'Ok'}
                                            </span>
                                        </div>
                                        <p class="text-[8px] text-slate-500">Faltam ${Math.max(0, (v.kmProximaManutencao || 10000) - (v.kmAtual - (v.kmUltimaManutencao || 0))).toLocaleString()} km</p>
                                    </div>
                                    <div>
                                        <div class="flex justify-between items-center mb-1">
                                            <span class="text-[10px] font-bold text-slate-400 uppercase">Troca de Óleo</span>
                                            <span class="text-[10px] font-bold ${((v.kmAtual - (v.kmTrocaOleo || 0)) >= (v.kmProximoOleo || 10000)) ? 'text-rose-500' : 'text-emerald-500'}">
                                                ${((v.kmAtual - (v.kmTrocaOleo || 0)) >= (v.kmProximoOleo || 10000)) ? 'Urgente' : 'Ok'}
                                            </span>
                                        </div>
                                        <p class="text-[8px] text-slate-500">Faltam ${Math.max(0, (v.kmProximoOleo || 10000) - (v.kmAtual - (v.kmTrocaOleo || 0))).toLocaleString()} km</p>
                                    </div>
                                    <div>
                                        <div class="flex justify-between items-center mb-1">
                                            <span class="text-[10px] font-bold text-slate-400 uppercase">Troca de Pneus</span>
                                            <span class="text-[10px] font-bold ${((v.kmAtual - (v.kmTrocaPneus || 0)) >= (v.kmProximoPneus || 40000)) ? 'text-rose-500' : 'text-emerald-500'}">
                                                ${((v.kmAtual - (v.kmTrocaPneus || 0)) >= (v.kmProximoPneus || 40000)) ? 'Urgente' : 'Ok'}
                                            </span>
                                        </div>
                                        <p class="text-[8px] text-slate-500">Faltam ${Math.max(0, (v.kmProximoPneus || 40000) - (v.kmAtual - (v.kmTrocaPneus || 0))).toLocaleString()} km</p>
                                    </div>
                                </div>

                                <div class="flex gap-2 pt-4 border-t border-slate-50"><button onclick="Pages.vehicles.openForm('${v.id}')" class="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-2 rounded-lg text-xs">Editar</button><button onclick="Pages.vehicles.delete('${v.id}')" class="bg-slate-50 hover:bg-rose-50 hover:text-rose-600 text-slate-400 py-2 px-3 rounded-lg"><i class="fa-solid fa-trash-can"></i></button></div>
                            </div>
                        `;
                    }).join('') || '<div class="col-span-full py-20 text-center text-slate-400 italic">Nenhum veículo cadastrado.</div>'}
                </div>
            `;
        },
        openForm(id = null) {
            const v = id ? DB.getById(ENTITIES.VEHICLES, id) : null;
            const defaultV = { 
                ativo: true, tipo: 'Caminhão', combustivel: 'Diesel S10', kmAtual: 0, 
                kmUltimaManutencao: 0, kmProximaManutencao: 10000, 
                kmTrocaOleo: 0, kmProximoOleo: 10000, 
                kmTrocaPneus: 0, kmProximoPneus: 40000, 
                ano: 2024, placa: '', modelo: '', cor: ''
            };
            const data = v ? v : defaultV;
            const html = `
                <form id="form-vehicle" class="space-y-4">
                    <input type="hidden" name="id" value="${data.id || ''}">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Placa</label><input type="text" name="placa" value="${data.placa || ''}" required placeholder="ABC-1234" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Modelo</label><input type="text" name="modelo" value="${data.modelo || ''}" required placeholder="Ex: Mercedes Axor" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Tipo</label><select name="tipo" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">${['Caminhão', 'Utilitário', 'Van', 'Carro', 'Moto'].map(t => `<option value="${t}" ${data.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Combustível</label><select name="combustivel" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">${['Diesel S10', 'Diesel', 'Flex', 'Gasolina', 'Etanol', 'GNV', 'Elétrico'].map(c => `<option value="${c}" ${data.combustivel === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">KM Atual</label><input type="number" name="kmAtual" value="${data.kmAtual || 0}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Ano</label><input type="number" name="ano" value="${data.ano || 2024}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    </div>
                    
                    <div class="border-t border-slate-200 pt-4 mt-4">
                        <h4 class="text-sm font-bold text-slate-700 mb-4">Manutenção</h4>
                        
                        <div class="grid grid-cols-2 gap-4 mb-4">
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">KM Última Revisão</label><input type="number" name="kmUltimaManutencao" value="${data.kmUltimaManutencao || 0}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Intervalo Revisão</label><input type="number" name="kmProximaManutencao" value="${data.kmProximaManutencao || 10000}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4 mb-4">
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">KM Troca de Óleo</label><input type="number" name="kmTrocaOleo" value="${data.kmTrocaOleo || 0}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Intervalo Óleo</label><input type="number" name="kmProximoOleo" value="${data.kmProximoOleo || 10000}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">KM Troca de Pneus</label><input type="number" name="kmTrocaPneus" value="${data.kmTrocaPneus || 0}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                            <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Intervalo Pneus</label><input type="number" name="kmProximoPneus" value="${data.kmProximoPneus || 40000}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        </div>
                    </div>
                    
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Cor</label><input type="text" name="cor" value="${data.cor || ''}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    <div class="flex items-center gap-2"><input type="checkbox" name="ativo" id="v-ativo" ${data.ativo ? 'checked' : ''} class="w-4 h-4 text-blue-600"><label for="v-ativo" class="text-sm font-medium text-slate-700">Veículo Ativo</label></div>
                </form>
            `;
            UI.openModal(id ? 'Editar Veículo' : 'Novo Veículo', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.vehicles.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        async save() {
            const form = document.getElementById('form-vehicle');
            const data = Object.fromEntries(new FormData(form).entries());
            data.kmAtual = parseInt(data.kmAtual); 
            data.ano = parseInt(data.ano); 
            data.kmUltimaManutencao = parseInt(data.kmUltimaManutencao);
            data.kmProximaManutencao = parseInt(data.kmProximaManutencao);
            data.kmTrocaOleo = parseInt(data.kmTrocaOleo);
            data.kmProximoOleo = parseInt(data.kmProximoOleo);
            data.kmTrocaPneus = parseInt(data.kmTrocaPneus);
            data.kmProximoPneus = parseInt(data.kmProximoPneus);
            data.ativo = form.ativo.checked ? 1 : 0;
            if (await DB.save(ENTITIES.VEHICLES, data)) { UI.toast(`Veículo ${data.placa} salvo!`, 'success'); UI.closeModal(); this.render(); }
        },
        async delete(id) { if (confirm('Excluir veículo?')) { await DB.delete(ENTITIES.VEHICLES, id); this.render(); } }
    },
    maintenance: {
        render() {
            const logs = DB.getAll(ENTITIES.MAINTENANCE_LOGS);
            const vehicles = DB.getAll(ENTITIES.VEHICLES);
            const container = document.getElementById('page-maintenance');
            container.innerHTML = `
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                    <div>
                        <h3 class="text-xl font-bold text-slate-800">Histórico de Manutenções</h3>
                        <p class="text-slate-500 text-sm">${logs.length} manutenções registradas</p>
                    </div>
                    <button onclick="Pages.maintenance.openForm()" class="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2">
                        <i class="fa-solid fa-plus"></i> Nova Manutenção
                    </button>
                </div>
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                            <tr>
                                <th class="px-6 py-4">Data</th>
                                <th class="px-6 py-4">Veículo</th>
                                <th class="px-6 py-4">Descrição</th>
                                <th class="px-6 py-4 text-right">KM no Momento</th>
                                <th class="px-6 py-4 text-right">Valor</th>
                                <th class="px-6 py-4 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100">
                            ${logs.sort((a, b) => new Date(b.data) - new Date(a.data)).map(log => {
                                const v = DB.getById(ENTITIES.VEHICLES, log.veiculoId);
                                return `
                                    <tr class="hover:bg-slate-50 transition-colors">
                                        <td class="px-6 py-4 whitespace-nowrap font-medium text-slate-600">${Utils.formatDate(log.data)}</td>
                                        <td class="px-6 py-4"><span class="bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono text-xs">${v ? v.placa : 'N/A'}</span></td>
                                        <td class="px-6 py-4 text-slate-700">${log.descricao}</td>
                                        <td class="px-6 py-4 text-right font-mono text-slate-600">${log.kmNoMomento ? log.kmNoMomento.toLocaleString() : 'N/A'} km</td>
                                        <td class="px-6 py-4 text-right font-bold text-emerald-600">${log.valor ? Utils.formatCurrency(log.valor) : 'N/A'}</td>
                                        <td class="px-6 py-4 text-center">
                                            <button onclick="Pages.maintenance.delete('${log.id}')" class="p-2 text-slate-400 hover:text-rose-600"><i class="fa-solid fa-trash-can"></i></button>
                                        </td>
                                    </tr>
                                `;
                            }).join('') || '<tr><td colspan="6" class="p-12 text-center text-slate-400 italic">Nenhuma manutenção registrada</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        },
        openForm() {
            const vehicles = DB.getAll(ENTITIES.VEHICLES).filter(v => v.ativo);
            const html = `
                <form id="form-maintenance" class="space-y-4">
                    <div class="space-y-1">
                        <label class="text-[11px] font-bold text-slate-500 uppercase">Veículo</label>
                        <select name="veiculoId" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                            <option value="">Selecione...</option>
                            ${vehicles.map(v => `<option value="${v.id}">${v.placa} - ${v.modelo}</option>`).join('')}
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1">
                            <label class="text-[11px] font-bold text-slate-500 uppercase">Data</label>
                            <input type="date" name="data" value="${new Date().toISOString().split('T')[0]}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        </div>
                        <div class="space-y-1">
                            <label class="text-[11px] font-bold text-slate-500 uppercase">Valor (R$)</label>
                            <input type="number" name="valor" step="0.01" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        </div>
                    </div>
                    <div class="space-y-1">
                        <label class="text-[11px] font-bold text-slate-500 uppercase">Descrição</label>
                        <select name="descricao" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                            <option value="Revisão Geral">Revisão Geral</option>
                            <option value="Troca de Óleo">Troca de Óleo</option>
                            <option value="Troca de Pneus">Troca de Pneus</option>
                            <option value="Balanceamento">Balanceamento</option>
                            <option value="Alinhamento">Alinhamento</option>
                            <option value="Outro">Outro</option>
                        </select>
                    </div>
                </form>
            `;
            UI.openModal('Nova Manutenção', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.maintenance.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        async save() {
            const form = document.getElementById('form-maintenance');
            const data = Object.fromEntries(new FormData(form).entries());
            data.valor = parseFloat(data.valor || 0);
            
            const vehicle = DB.getById(ENTITIES.VEHICLES, data.veiculoId);
            data.kmNoMomento = vehicle ? vehicle.kmAtual : 0;
            
            await DB.save(ENTITIES.MAINTENANCE_LOGS, data);
            
            if (vehicle) {
                if (data.descricao === 'Revisão Geral') {
                    vehicle.kmUltimaManutencao = vehicle.kmAtual;
                } else if (data.descricao === 'Troca de Óleo') {
                    vehicle.kmTrocaOleo = vehicle.kmAtual;
                } else if (data.descricao === 'Troca de Pneus') {
                    vehicle.kmTrocaPneus = vehicle.kmAtual;
                }
                await DB.save(ENTITIES.VEHICLES, vehicle);
            }
            
            UI.toast('Manutenção registrada!', 'success');
            UI.closeModal();
            this.render();
        },
        async delete(id) { if (confirm('Excluir esta manutenção?')) { await DB.delete(ENTITIES.MAINTENANCE_LOGS, id); this.render(); } }
    },
    drivers: {
        render() {
            const list = DB.getAll(ENTITIES.DRIVERS);
            const container = document.getElementById('page-drivers');
            container.innerHTML = `
                <div class="flex justify-between items-center mb-8"><div><h3 class="text-xl font-bold text-slate-800">Motoristas</h3><p class="text-slate-500 text-sm">${list.length} motoristas cadastrados</p></div><button onclick="Pages.drivers.openForm()" class="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200"><i class="fa-solid fa-plus"></i> Novo Motorista</button></div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    ${list.map(d => `
                        <div class="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 relative">
                            <div class="absolute top-3 right-3"><span class="${d.ativo ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'} text-[10px] font-bold uppercase px-2 py-1 rounded-full">${d.ativo ? 'Ativo' : 'Inativo'}</span></div>
                            <div class="flex items-center gap-4 mb-6"><div class="w-14 h-14 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold">${d.nome.charAt(0).toUpperCase()}</div><div><h4 class="font-bold text-slate-800">${d.nome}</h4><p class="text-xs text-slate-500">CNH: ${d.cnh} (${d.categoria})</p></div></div>
                            <div class="space-y-2 mb-6 text-sm"><p><i class="fa-solid fa-phone text-slate-400 w-4"></i> ${d.telefone}</p><p><i class="fa-solid fa-money-bill-1 text-emerald-500 w-4"></i> <span class="font-bold text-emerald-600">Diária: ${Utils.formatCurrency(d.valorDiaria)}</span></p></div>
                            <div class="flex gap-2 pt-4 border-t border-slate-50"><button onclick="Pages.drivers.openForm('${d.id}')" class="flex-1 bg-slate-50 text-slate-600 font-bold py-2 rounded-lg text-xs">Editar</button><button onclick="Pages.drivers.delete('${d.id}')" class="bg-slate-50 text-slate-400 py-2 px-3 rounded-lg"><i class="fa-solid fa-trash-can"></i></button></div>
                        </div>
                    `).join('') || '<p class="col-span-full py-12 text-center text-slate-400">Sem motoristas.</p>'}
                </div>
            `;
        },
        openForm(id = null) {
            const d = id ? DB.getById(ENTITIES.DRIVERS, id) : { ativo: true, valorDiaria: 0, valorDomingo: 0 };
            const html = `
                <form id="form-driver" class="space-y-4">
                    <input type="hidden" name="id" value="${d.id || ''}">
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Nome Completo</label><input type="text" name="nome" value="${d.nome || ''}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">CNH</label><input type="text" name="cnh" value="${d.cnh || ''}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Categoria</label><select name="categoria" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">${['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'].map(c => `<option value="${c}" ${d.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Telefone</label><input type="text" name="telefone" value="${d.telefone || ''}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Valor Diária (R$)</label><input type="number" name="valorDiaria" value="${d.valorDiaria}" step="0.01" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    </div>
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Valor Domingo (R$)</label><input type="number" name="valorDomingo" value="${d.valorDomingo || 0}" step="0.01" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    <div class="flex items-center gap-2"><input type="checkbox" name="ativo" id="d-ativo" ${d.ativo ? 'checked' : ''} class="w-4 h-4 text-blue-600"><label for="d-ativo" class="text-sm font-medium text-slate-700">Motorista Ativo</label></div>
                </form>
            `;
            UI.openModal(id ? 'Editar Motorista' : 'Novo Motorista', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.drivers.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        async save() {
            const form = document.getElementById('form-driver');
            const data = Object.fromEntries(new FormData(form).entries());
            data.valorDiaria = parseFloat(data.valorDiaria || 0);
            data.valorDomingo = parseFloat(data.valorDomingo || 0);
            data.ativo = form.ativo.checked ? 1 : 0;
            if (await DB.save(ENTITIES.DRIVERS, data)) { UI.toast(`Motorista ${data.nome} salvo!`, 'success'); UI.closeModal(); this.render(); }
        },
        async delete(id) { if (confirm('Excluir motorista?')) { await DB.delete(ENTITIES.DRIVERS, id); this.render(); } }
    },
    routes: {
        currentFilterDate: new Date().toISOString().split('T')[0],
        viewType: 'monthly', // Default to monthly as requested
        currentFilterMonth: new Date().toISOString().slice(0, 7),
        
        render() {
            let list = DB.getAll(ENTITIES.ROUTES);
            
            if (this.viewType === 'daily') {
                list = list.filter(r => r.data === this.currentFilterDate);
            } else {
                list = list.filter(r => r.data.startsWith(this.currentFilterMonth));
            }

            const totalKm = list.reduce((acc, r) => acc + parseFloat(r.km || 0), 0);
            const totalFrete = list.reduce((acc, r) => acc + parseFloat(r.valorFrete || 0), 0);

            const container = document.getElementById('page-routes');
            container.innerHTML = `
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                    <div>
                        <h3 class="text-xl font-bold text-slate-800">Controle de Rotas</h3>
                        <div class="flex gap-1 bg-slate-100 p-1 rounded-lg mt-2">
                            <button onclick="Pages.routes.setViewType('daily')" class="px-4 py-1 text-[10px] font-black uppercase rounded-md ${this.viewType === 'daily' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}">Diário</button>
                            <button onclick="Pages.routes.setViewType('monthly')" class="px-4 py-1 text-[10px] font-black uppercase rounded-md ${this.viewType === 'monthly' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}">Mensal</button>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-3">
                        ${this.viewType === 'daily' ? 
                            `<input type="date" value="${this.currentFilterDate}" onchange="Pages.routes.currentFilterDate = this.value; Pages.routes.render()" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none">` :
                            `<input type="month" value="${this.currentFilterMonth}" onchange="Pages.routes.currentFilterMonth = this.value; Pages.routes.render()" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none">`
                        }
                        <button onclick="Pages.routes.openForm()" class="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-100">
                            <i class="fa-solid fa-plus"></i> Nova Rota
                        </button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                        <p class="text-[10px] font-black text-slate-400 uppercase mb-1">Total de Rotas</p>
                        <h4 class="text-xl font-bold text-slate-800">${list.length} viagens</h4>
                    </div>
                    <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                        <p class="text-[10px] font-black text-slate-400 uppercase mb-1">Km Total</p>
                        <h4 class="text-xl font-bold text-slate-800">${totalKm.toLocaleString()} km</h4>
                    </div>
                    <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                        <p class="text-[10px] font-black text-slate-400 uppercase mb-1">Receita Total</p>
                        <h4 class="text-xl font-bold text-emerald-600">${Utils.formatCurrency(totalFrete)}</h4>
                    </div>
                </div>

                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-sm">
                            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                                <tr>
                                    <th class="px-6 py-4">Data</th>
                                    <th class="px-6 py-4">Motorista</th>
                                    <th class="px-6 py-4">Veículo</th>
                                    <th class="px-6 py-4">Origem / Destino</th>
                                    <th class="px-6 py-4 text-right">Km</th>
                                    <th class="px-6 py-4 text-right">Frete</th>
                                    <th class="px-6 py-4 text-center">Ações</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${list.sort((a, b) => new Date(b.data) - new Date(a.data)).map(r => `
                                    <tr class="hover:bg-slate-50 transition-colors">
                                        <td class="px-6 py-4 whitespace-nowrap font-medium text-slate-600">${Utils.formatDate(r.data)}</td>
                                        <td class="px-6 py-4 font-bold text-slate-700">${DB.getById(ENTITIES.DRIVERS, r.motoristaId)?.nome || 'N/A'}</td>
                                        <td class="px-6 py-4"><span class="bg-slate-100 text-slate-700 px-2 py-1 rounded font-mono text-xs">${DB.getById(ENTITIES.VEHICLES, r.veiculoId)?.placa || 'N/A'}</span></td>
                                        <td class="px-6 py-4 text-slate-500 text-xs">${r.origem} <i class="fa-solid fa-arrow-right mx-1 opacity-30"></i> ${r.destino}</td>
                                        <td class="px-6 py-4 text-right font-mono">${parseFloat(r.km || 0).toLocaleString()}</td>
                                        <td class="px-6 py-4 text-right font-bold text-emerald-600">${Utils.formatCurrency(r.valorFrete)}</td>
                                        <td class="px-6 py-4 text-center">
                                            <div class="flex justify-center gap-1">
                                                <button onclick="Pages.routes.openForm('${r.id}')" class="p-2 text-slate-400 hover:text-blue-600 transition-colors"><i class="fa-solid fa-pen"></i></button>
                                                <button onclick="Pages.routes.delete('${r.id}')" class="p-2 text-slate-400 hover:text-rose-600 transition-colors"><i class="fa-solid fa-trash-can"></i></button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join('') || '<tr><td colspan="7" class="p-12 text-center text-slate-400 italic font-medium">Nenhuma rota encontrada para este período.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        },
        setViewType(type) {
            this.viewType = type;
            this.render();
        },
        openForm(id = null) {
            const r = id ? DB.getById(ENTITIES.ROUTES, id) : { data: this.currentFilterDate };
            const drivers = DB.getAll(ENTITIES.DRIVERS).filter(d => d.ativo);
            const vehicles = DB.getAll(ENTITIES.VEHICLES).filter(v => v.ativo);
            const html = `
                <form id="form-route" class="space-y-4">
                    <input type="hidden" name="id" value="${r.id || ''}">
                    <div class="flex justify-between items-center bg-blue-50 p-3 rounded-lg mb-4">
                        <span class="text-xs font-bold text-blue-700 uppercase">Integração GPS</span>
                        <button type="button" onclick="Pages.routes.fillFromGPS()" class="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-blue-700 transition-all">
                            <i class="fa-solid fa-satellite-dish"></i> Importar Rota Atual
                        </button>
                    </div>
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Data</label><input type="date" name="data" value="${r.data}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Motorista</label><select name="motoristaId" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="">Selecione...</option>${drivers.map(d => `<option value="${d.id}" ${r.motoristaId === d.id ? 'selected' : ''}>${d.nome}</option>`).join('')}</select></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Veículo</label><select name="veiculoId" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="">Selecione...</option>${vehicles.map(v => `<option value="${v.id}" ${r.veiculoId === v.id ? 'selected' : ''}>${v.placa}</option>`).join('')}</select></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Origem</label><input type="text" name="origem" value="${r.origem || ''}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Destino</label><input type="text" name="destino" value="${r.destino || ''}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Km</label><input type="number" name="km" value="${r.km || 0}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Frete (R$)</label><input type="number" name="valorFrete" value="${r.valorFrete || 0}" step="0.01" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    </div>
                </form>
            `;
            UI.openModal(id ? 'Editar Rota' : 'Nova Rota', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.routes.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        async fillFromGPS() {
            const data = await Utils.fetchGPSData();
            const form = document.getElementById('form-route');
            if (form) {
                form.origem.value = data.origem;
                form.destino.value = data.destino;
                form.km.value = data.km;
                // Simula um valor de frete baseado no KM importado
                form.valorFrete.value = (data.km * 5.5).toFixed(2);
            }
        },
        async save() {
            const form = document.getElementById('form-route');
            const data = Object.fromEntries(new FormData(form).entries());
            data.km = parseFloat(data.km || 0); 
            data.valorFrete = parseFloat(data.valorFrete || 0);
            if (await DB.save(ENTITIES.ROUTES, data)) { UI.toast('Rota salva!', 'success'); UI.closeModal(); this.render(); }
        },
        async delete(id) { if (confirm('Excluir rota?')) { await DB.delete(ENTITIES.ROUTES, id); this.render(); } }
    },
    fuel: {
        currentFilterMonth: new Date().toISOString().slice(0, 7),
        render() {
            const list = DB.getAll(ENTITIES.FUEL).filter(f => f.data.startsWith(this.currentFilterMonth));
            const container = document.getElementById('page-fuel');
            container.innerHTML = `
                <div class="flex justify-between items-center mb-8"><div><h3 class="text-xl font-bold text-slate-800">Combustível</h3><input type="month" value="${this.currentFilterMonth}" onchange="Pages.fuel.currentFilterMonth = this.value; Pages.fuel.render()" class="bg-white border border-slate-200 rounded-lg px-3 py-1 text-sm mt-1"></div><button onclick="Pages.fuel.openForm()" class="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200"><i class="fa-solid fa-plus"></i> Novo Abastecimento</button></div>
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]"><tr><th class="px-6 py-4">Data</th><th class="px-6 py-4">Veículo</th><th class="px-6 py-4">Combustível</th><th class="px-6 py-4 text-right">Litros</th><th class="px-6 py-4 text-right">Total</th><th class="px-6 py-4 text-center">Ações</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${list.map(f => `
                                <tr><td class="px-6 py-4">${Utils.formatDate(f.data)}</td><td class="px-6 py-4 font-mono text-xs">${DB.getById(ENTITIES.VEHICLES, f.veiculoId)?.placa || 'N/A'}</td><td class="px-6 py-4">${f.tipoCombustivel}</td><td class="px-6 py-4 text-right">${f.litros} L</td><td class="px-6 py-4 text-right font-bold text-rose-600">${Utils.formatCurrency(f.valorTotal)}</td><td class="px-6 py-4 text-center"><button onclick="Pages.fuel.delete('${f.id}')" class="p-2 text-slate-400 hover:text-rose-600"><i class="fa-solid fa-trash-can"></i></button></td></tr>
                            `).join('') || '<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Sem abastecimentos este mês.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        },
        openForm() {
            const vehicles = DB.getAll(ENTITIES.VEHICLES).filter(v => v.ativo);
            const html = `
                <form id="form-fuel" class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Data</label><input type="date" name="data" value="${new Date().toISOString().split('T')[0]}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Veículo</label><select name="veiculoId" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="">Selecione...</option>${vehicles.map(v => `<option value="${v.id}">${v.placa}</option>`).join('')}</select></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Combustível</label><select name="tipoCombustivel" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="Diesel S10">Diesel S10</option><option value="Diesel">Diesel</option><option value="Flex">Flex</option></select></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Litros</label><input type="number" name="litros" step="0.01" required oninput="const p=this.form.vL.value||0; this.form.vT.value=(this.value*p).toFixed(2)" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Valor/L</label><input type="number" name="vL" step="0.001" required oninput="const l=this.form.litros.value||0; this.form.vT.value=(this.value*l).toFixed(2)" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Total (R$)</label><input type="number" name="vT" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"></div>
                    </div>
                </form>
            `;
            UI.openModal('Novo Abastecimento', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.fuel.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        async save() {
            const form = document.getElementById('form-fuel');
            const data = { 
                data: form.data.value, 
                veiculoId: form.veiculoId.value, 
                tipoCombustivel: form.tipoCombustivel.value, 
                litros: parseFloat(form.litros.value || 0), 
                valorTotal: parseFloat(form.vT.value || 0), 
                posto: 'Geral' 
            };
            if (await DB.save(ENTITIES.FUEL, data)) { UI.toast('Abastecimento registrado!', 'success'); UI.closeModal(); this.render(); }
        },
        async delete(id) { if (confirm('Excluir abastecimento?')) { await DB.delete(ENTITIES.FUEL, id); this.render(); } }
    },
    finance: {
        activeTab: 'payables',
        render() {
            const key = this.activeTab === 'payables' ? ENTITIES.PAYABLES : ENTITIES.RECEIVABLES;
            const list = DB.getAll(key);
            const container = document.getElementById('page-finance');
            container.innerHTML = `
                <div class="flex justify-between items-center mb-8"><div><h3 class="text-xl font-bold text-slate-800">Financeiro</h3><div class="flex gap-1 bg-slate-100 p-1 rounded-lg mt-1"><button onclick="Pages.finance.activeTab='payables'; Pages.finance.render()" class="px-4 py-1 text-xs font-bold rounded-md ${this.activeTab==='payables'?'bg-white text-blue-600 shadow-sm':'text-slate-500'}">Pagar</button><button onclick="Pages.finance.activeTab='receivables'; Pages.finance.render()" class="px-4 py-1 text-xs font-bold rounded-md ${this.activeTab==='receivables'?'bg-white text-blue-600 shadow-sm':'text-slate-500'}">Receber</button></div></div><button onclick="Pages.finance.openForm()" class="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-200"><i class="fa-solid fa-plus"></i> Novo</button></div>
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]"><tr><th class="px-6 py-4">Vencimento</th><th class="px-6 py-4">Descrição</th><th class="px-6 py-4 text-right">Valor</th><th class="px-6 py-4 text-center">Status</th><th class="px-6 py-4 text-center">Ações</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${list.sort((a,b)=>new Date(a.vencimento)-new Date(b.vencimento)).map(i => `
                                <tr>
                                    <td class="px-6 py-4">${Utils.formatDate(i.vencimento)}</td>
                                    <td class="px-6 py-4 font-bold text-slate-700">${i.descricao}</td>
                                    <td class="px-6 py-4 text-right font-bold ${this.activeTab==='payables'?'text-rose-600':'text-emerald-600'}">${Utils.formatCurrency(i.valor)}</td>
                                    <td class="px-6 py-4 text-center">
                                        <button onclick="Pages.finance.toggle('${i.id}')" class="px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${i.status==='pago'||i.status==='recebido'?'bg-emerald-100 text-emerald-600':'bg-amber-100 text-amber-600 hover:bg-amber-200'}">
                                            <i class="fa-solid ${i.status==='pago'||i.status==='recebido'?'fa-check-double':'fa-clock'} mr-1"></i> ${i.status}
                                        </button>
                                    </td>
                                    <td class="px-6 py-4 text-center">
                                        <button onclick="Pages.finance.openForm('${i.id}')" class="p-2 text-slate-400 hover:text-blue-600"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="Pages.finance.delete('${i.id}')" class="p-2 text-slate-400 hover:text-rose-600"><i class="fa-solid fa-trash-can"></i></button>
                                    </td>
                                </tr>
                            `).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-400">Vazio.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        },
        openForm(id = null) {
            const i = id ? DB.getById(this.activeTab === 'payables' ? ENTITIES.PAYABLES : ENTITIES.RECEIVABLES, id) : { vencimento: new Date().toISOString().split('T')[0], valor: 0 };
            const html = `
                <form id="form-finance" class="space-y-4">
                    <input type="hidden" name="id" value="${i.id || ''}">
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Descrição</label><input type="text" name="desc" value="${i.descricao || ''}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Valor (R$)</label><input type="number" name="val" value="${i.valor}" step="0.01" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Vencimento</label><input type="date" name="venc" value="${i.vencimento}" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    </div>
                </form>
            `;
            UI.openModal(id ? 'Editar Lançamento' : 'Novo Lançamento', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.finance.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        async save() {
            const form = document.getElementById('form-finance');
            const id = form.id.value;
            const data = { 
                id: id || undefined, 
                descricao: form.desc.value, 
                valor: parseFloat(form.val.value || 0), 
                vencimento: form.venc.value, 
                status: id ? DB.getById(this.activeTab === 'payables' ? ENTITIES.PAYABLES : ENTITIES.RECEIVABLES, id).status : 'pendente', 
                categoria: 'Geral' 
            };
            await DB.save(this.activeTab === 'payables' ? ENTITIES.PAYABLES : ENTITIES.RECEIVABLES, data);
            UI.toast('Salvo!', 'success'); UI.closeModal(); this.render();
        },
        async toggle(id) {
            const key = this.activeTab === 'payables' ? ENTITIES.PAYABLES : ENTITIES.RECEIVABLES;
            const item = DB.getById(key, id);
            // Fix: properly handle status toggle based on entity type
            if (this.activeTab === 'payables') {
                item.status = item.status === 'pago' ? 'pendente' : 'pago';
            } else {
                item.status = item.status === 'recebido' ? 'pendente' : 'recebido';
            }
            await DB.save(key, item); this.render();
        },
        async delete(id) { if (confirm('Excluir?')) { await DB.delete(this.activeTab === 'payables' ? ENTITIES.PAYABLES : ENTITIES.RECEIVABLES, id); this.render(); } }
    },
    payments: {
        render() {
            const payments = DB.getAll(ENTITIES.DRIVER_PAYMENTS);
            const totalPaid = payments.reduce((acc, p) => acc + parseFloat(p.valorFinal || 0), 0);
            
            const container = document.getElementById('page-payments');
            container.innerHTML = `
                <div class="flex justify-between items-center mb-8">
                    <div>
                        <h3 class="text-xl font-bold text-slate-800">Pagamentos Motoristas</h3>
                        <p class="text-slate-500 text-sm">Total acumulado: <span class="font-bold text-emerald-600">${Utils.formatCurrency(totalPaid)}</span></p>
                    </div>
                    <button onclick="Pages.payments.openForm()" class="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold"><i class="fa-solid fa-plus"></i> Novo Fechamento</button>
                </div>
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <table class="w-full text-left text-sm">
                        <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]"><tr><th class="px-6 py-4">Motorista</th><th class="px-6 py-4">Período</th><th class="px-6 py-4 text-right">Total a Pagar</th><th class="px-6 py-4 text-center">Status</th><th class="px-6 py-4 text-center">Ações</th></tr></thead>
                        <tbody class="divide-y divide-slate-100">
                            ${payments.sort((a,b) => b.ano - a.ano || b.mes - a.mes).map(p => `
                                <tr>
                                    <td class="px-6 py-4 font-bold text-slate-700">${DB.getById(ENTITIES.DRIVERS, p.motoristaId)?.nome || 'N/A'}</td>
                                    <td class="px-6 py-4">${p.periodoInicio && p.periodoFim ? `${Utils.formatDate(p.periodoInicio)} até ${Utils.formatDate(p.periodoFim)}` : `${p.mes}/${p.ano}`}</td>
                                    <td class="px-6 py-4 text-right font-black text-emerald-600">${Utils.formatCurrency(p.valorFinal)}</td>
                                    <td class="px-6 py-4 text-center">
                                        <button onclick="Pages.payments.toggle('${p.id}')" class="px-3 py-1.5 rounded-full text-[9px] font-black uppercase transition-all ${p.pago ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600 hover:bg-amber-200'}">
                                            <i class="fa-solid ${p.pago ? 'fa-check-double' : 'fa-clock'} mr-1"></i> ${p.pago ? 'Pago' : 'Pendente'}
                                        </button>
                                    </td>
                                    <td class="px-6 py-4 text-center">
                                        <button onclick="Pages.payments.exportPDF('${p.id}')" class="p-2 text-slate-400 hover:text-blue-600"><i class="fa-solid fa-file-pdf"></i></button>
                                        <button onclick="Pages.payments.delete('${p.id}')" class="p-2 text-slate-400 hover:text-rose-600"><i class="fa-solid fa-trash-can"></i></button>
                                    </td>
                                </tr>
                            `).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-400">Sem pagamentos.</td></tr>'}
                        </tbody>
                    </table>
                </div>
            `;
        },
        openForm() {
            const drivers = DB.getAll(ENTITIES.DRIVERS).filter(d => d.ativo);
            const now = new Date();
            const html = `
                <form id="form-pay" class="space-y-4">
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Motorista</label>
                        <select name="mId" required onchange="Pages.payments.updateDefaults(this.value)" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                            <option value="">Selecione...</option>
                            ${drivers.map(d => `<option value="${d.id}">${d.nome}</option>`).join('')}
                        </select>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Tipo</label>
                            <select name="tipo" onchange="Pages.payments.recalc()" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                                <option value="quinzenal">Quinzenal</option>
                                <option value="mensal">Mensal</option>
                            </select>
                        </div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Quinzena</label>
                            <select name="quinzena" onchange="Pages.payments.recalc()" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                                <option value="1">1ª (01–15)</option>
                                <option value="2">2ª (16–fim)</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Mês</label><input type="number" name="mes" value="${now.getMonth() + 1}" required onchange="Pages.payments.recalc()" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Ano</label><input type="number" name="ano" value="${now.getFullYear()}" required onchange="Pages.payments.recalc()" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"></div>
                    </div>
                    <div id="pay-summary" class="hidden bg-blue-50 p-3 rounded-lg mb-4">
                        <div class="text-xs text-blue-700 font-bold mb-2">Resumo do Período:</div>
                        <div class="grid grid-cols-2 gap-2 text-xs text-blue-600">
                            <div>Rotas: <span id="summary-rotas" class="font-bold">0</span></div>
                            <div>KM Total: <span id="summary-km" class="font-bold">0</span></div>
                            <div>Frete Total: <span id="summary-frete" class="font-bold">R$ 0,00</span></div>
                            <div>Diária: <span id="summary-diaria" class="font-bold">R$ 0,00</span></div>
                        </div>
                        <div class="mt-2 text-[10px] text-blue-700 font-bold">Período: <span id="summary-periodo" class="font-black"></span></div>
                        <div id="summary-adiant-list" class="mt-3"></div>
                        <div id="summary-adjust-list" class="mt-2"></div>
                        <div class="mt-3 flex flex-wrap gap-2">
                            <button type="button" onclick="Pages.payments.toggleInlineForm('adiant')" class="bg-white border border-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-blue-100 transition-colors">+ Adiantamento</button>
                            <button type="button" onclick="Pages.payments.toggleInlineForm('adjust')" class="bg-white border border-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase hover:bg-blue-100 transition-colors">+ Desconto/Extra/PNR</button>
                        </div>
                        <div id="inline-adiant-form" class="hidden mt-3 bg-white border border-amber-200 rounded-lg p-3">
                            <div class="text-[10px] font-black text-amber-700 uppercase mb-2">Novo Adiantamento</div>
                            <div class="grid grid-cols-3 gap-2">
                                <input type="date" id="inl-adiant-data" value="${new Date().toISOString().split('T')[0]}" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
                                <input type="number" id="inl-adiant-valor" step="0.01" placeholder="Valor R$" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
                                <input type="text" id="inl-adiant-obs" placeholder="Observação" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
                            </div>
                            <div class="flex gap-2 mt-2">
                                <button type="button" onclick="Pages.payments.saveInlineAdiant()" class="bg-amber-500 text-white px-3 py-1 rounded-lg text-[10px] font-bold">Salvar</button>
                                <button type="button" onclick="Pages.payments.toggleInlineForm('adiant')" class="text-slate-400 px-3 py-1 text-[10px] font-bold">Cancelar</button>
                            </div>
                        </div>
                        <div id="inline-adjust-form" class="hidden mt-3 bg-white border border-rose-200 rounded-lg p-3">
                            <div class="text-[10px] font-black text-rose-700 uppercase mb-2">Novo Desconto/Extra/PNR</div>
                            <div class="grid grid-cols-2 gap-2 mb-2">
                                <input type="date" id="inl-adjust-data" value="${new Date().toISOString().split('T')[0]}" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
                                <select id="inl-adjust-tipo" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
                                    <option value="desconto">Desconto</option>
                                    <option value="pnr">PNR</option>
                                    <option value="extra">Extra</option>
                                </select>
                            </div>
                            <div class="grid grid-cols-2 gap-2">
                                <input type="number" id="inl-adjust-valor" step="0.01" placeholder="Valor R$" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
                                <input type="text" id="inl-adjust-obs" placeholder="Observação" class="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px]">
                            </div>
                            <div class="flex gap-2 mt-2">
                                <button type="button" onclick="Pages.payments.saveInlineAdjust()" class="bg-rose-500 text-white px-3 py-1 rounded-lg text-[10px] font-bold">Salvar</button>
                                <button type="button" onclick="Pages.payments.toggleInlineForm('adjust')" class="text-slate-400 px-3 py-1 text-[10px] font-bold">Cancelar</button>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Dias Trabalhados</label><input type="number" name="dias" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Diária Base (R$)</label><input type="number" name="val" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"></div>
                    </div>
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Valor Diárias (R$)</label><input type="number" name="bruto" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700"></div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Adiantamentos (R$)</label><input type="number" name="adiant" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">PNR (R$)</label><input type="number" name="pnr" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Descontos (R$)</label><input type="number" name="desc" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"></div>
                        <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Extras (R$)</label><input type="number" name="extra" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"></div>
                    </div>
                    <div class="space-y-1"><label class="text-[11px] font-bold text-slate-500 uppercase">Total Final (R$)</label><input type="number" name="total" readonly class="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-emerald-600"></div>
                </form>
            `;
            UI.openModal('Novo Fechamento', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.payments.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        updateDefaults(driverId) {
            const driver = DB.getById(ENTITIES.DRIVERS, driverId);
            const form = document.getElementById('form-pay');
            if (driver && form) {
                this.recalc();
            }
        },
        recalc() {
            const form = document.getElementById('form-pay');
            if (!form) return;
            const driverId = form.mId.value;
            if (!driverId) return;
            const driver = DB.getById(ENTITIES.DRIVERS, driverId);
            const mes = parseInt(form.mes.value);
            const ano = parseInt(form.ano.value);
            const tipo = form.tipo.value;
            const lastDay = Utils.lastDayOfMonth(ano, mes);
            const start = tipo === 'quinzenal' ? (form.quinzena.value === '1' ? `${ano}-${String(mes).padStart(2,'0')}-01` : `${ano}-${String(mes).padStart(2,'0')}-16`) : `${ano}-${String(mes).padStart(2,'0')}-01`;
            const end = tipo === 'quinzenal' ? (form.quinzena.value === '1' ? `${ano}-${String(mes).padStart(2,'0')}-15` : `${ano}-${String(mes).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`) : `${ano}-${String(mes).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
            const rotas = DB.getAll(ENTITIES.ROUTES).filter(r => r.motoristaId === driverId && (r.data >= start && r.data <= end));
            const diasSet = new Set(rotas.map(r => r.data));
            const diasList = Array.from(diasSet).sort();
            form.dias.value = diasList.length;
            const totalKm = rotas.reduce((acc, r) => acc + parseFloat(r.km || 0), 0);
            const totalFrete = rotas.reduce((acc, r) => acc + parseFloat(r.valorFrete || 0), 0);
            const adiantItems = DB.getAll(ENTITIES.ADIANTAMENTOS).filter(a => a.motoristaId === driverId && (a.data >= start && a.data <= end));
            const adiant = adiantItems.reduce((acc, a) => acc + parseFloat(a.valor || 0), 0);
            const adjustments = DB.getAll(ENTITIES.DRIVER_ADJUSTMENTS).filter(a => a.motoristaId === driverId && (a.data >= start && a.data <= end));
            const pnr = adjustments.filter(a => a.tipo === 'pnr').reduce((acc, a) => acc + parseFloat(a.valor || 0), 0);
            const descontos = adjustments.filter(a => a.tipo === 'desconto').reduce((acc, a) => acc + parseFloat(a.valor || 0), 0);
            const extras = adjustments.filter(a => a.tipo === 'extra').reduce((acc, a) => acc + parseFloat(a.valor || 0), 0);

            const diariaBase = parseFloat(driver?.valorDiaria || 0);
            const diariaDomingo = Utils.getSundayRate(driver);
            let bruto = 0;
            for (const dateStr of diasList) {
                if (Utils.isSunday(dateStr) && diariaDomingo > 0) bruto += diariaDomingo;
                else bruto += diariaBase;
            }
            form.val.value = diariaBase.toFixed(2);
            form.bruto.value = bruto.toFixed(2);
            form.adiant.value = adiant.toFixed(2);
            form.pnr.value = pnr.toFixed(2);
            form.desc.value = descontos.toFixed(2);
            form.extra.value = extras.toFixed(2);
            const summaryEl = document.getElementById('pay-summary');
            if (summaryEl) {
                summaryEl.classList.remove('hidden');
                document.getElementById('summary-rotas').textContent = rotas.length;
                document.getElementById('summary-km').textContent = totalKm.toLocaleString();
                document.getElementById('summary-frete').textContent = Utils.formatCurrency(totalFrete);
                document.getElementById('summary-diaria').textContent = Utils.formatCurrency(driver?.valorDiaria || 0);
                document.getElementById('summary-periodo').textContent = `${Utils.formatDate(start)} até ${Utils.formatDate(end)}`;

                // Render adiantamentos list with delete buttons
                const adiantListEl = document.getElementById('summary-adiant-list');
                if (adiantListEl) {
                    if (adiantItems.length > 0) {
                        adiantListEl.innerHTML = `
                            <div class="text-[10px] font-black text-amber-700 uppercase mb-1">Adiantamentos (${Utils.formatCurrency(adiant)}):</div>
                            <div class="space-y-1">
                                ${adiantItems.map(a => `
                                    <div class="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                                        <div class="flex items-center gap-2 text-[10px]">
                                            <span class="text-amber-600">${Utils.formatDate(a.data)}</span>
                                            <span class="font-bold text-amber-800">${Utils.formatCurrency(a.valor)}</span>
                                            ${a.observacao ? `<span class="text-amber-500 italic">${a.observacao}</span>` : ''}
                                        </div>
                                        <button type="button" onclick="Pages.payments.deleteAdiantamento('${a.id}')" class="text-amber-400 hover:text-rose-600 transition-colors p-1" title="Excluir adiantamento">
                                            <i class="fa-solid fa-trash-can text-[10px]"></i>
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                        `;
                    } else {
                        adiantListEl.innerHTML = '';
                    }
                }

                // Render adjustments list (PNR/Descontos/Extras) with delete buttons
                const adjustListEl = document.getElementById('summary-adjust-list');
                if (adjustListEl) {
                    if (adjustments.length > 0) {
                        const tipoLabels = { pnr: 'PNR', desconto: 'Desconto', extra: 'Extra' };
                        const tipoColors = { 
                            pnr: { bg: 'bg-rose-50', border: 'border-rose-200', label: 'text-rose-700', value: 'text-rose-800', icon: 'text-rose-400' },
                            desconto: { bg: 'bg-orange-50', border: 'border-orange-200', label: 'text-orange-700', value: 'text-orange-800', icon: 'text-orange-400' },
                            extra: { bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'text-emerald-700', value: 'text-emerald-800', icon: 'text-emerald-400' }
                        };
                        adjustListEl.innerHTML = `
                            <div class="text-[10px] font-black text-slate-600 uppercase mb-1">Ajustes (PNR: ${Utils.formatCurrency(pnr)} | Desc: ${Utils.formatCurrency(descontos)} | Extras: ${Utils.formatCurrency(extras)}):</div>
                            <div class="space-y-1">
                                ${adjustments.map(a => {
                                    const colors = tipoColors[a.tipo] || tipoColors.desconto;
                                    return `
                                    <div class="flex items-center justify-between ${colors.bg} border ${colors.border} rounded-lg px-2 py-1.5">
                                        <div class="flex items-center gap-2 text-[10px]">
                                            <span class="${colors.label} font-black uppercase">${tipoLabels[a.tipo] || a.tipo}</span>
                                            <span class="text-slate-400">•</span>
                                            <span class="text-slate-500">${Utils.formatDate(a.data)}</span>
                                            <span class="font-bold ${colors.value}">${Utils.formatCurrency(a.valor)}</span>
                                            ${a.observacao ? `<span class="text-slate-400 italic">${a.observacao}</span>` : ''}
                                        </div>
                                        <button type="button" onclick="Pages.payments.deleteAdjustment('${a.id}')" class="${colors.icon} hover:text-rose-600 transition-colors p-1" title="Excluir ajuste">
                                            <i class="fa-solid fa-trash-can text-[10px]"></i>
                                        </button>
                                    </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    } else {
                        adjustListEl.innerHTML = '';
                    }
                }
            }
            this.calcTotal();
        },
        async deleteAdiantamento(id) {
            if (!confirm('Excluir este adiantamento?')) return;
            await DB.delete(ENTITIES.ADIANTAMENTOS, id);
            UI.toast('Adiantamento excluído!', 'success');
            this.recalc();
        },
        async deleteAdjustment(id) {
            if (!confirm('Excluir este ajuste?')) return;
            await DB.delete(ENTITIES.DRIVER_ADJUSTMENTS, id);
            UI.toast('Ajuste excluído!', 'success');
            this.recalc();
        },
        toggleInlineForm(type) {
            const el = document.getElementById(type === 'adiant' ? 'inline-adiant-form' : 'inline-adjust-form');
            if (el) el.classList.toggle('hidden');
        },
        async saveInlineAdiant() {
            const form = document.getElementById('form-pay');
            if (!form || !form.mId.value) return;
            const dataVal = document.getElementById('inl-adiant-data').value;
            const valor = parseFloat(document.getElementById('inl-adiant-valor').value || 0);
            const obs = document.getElementById('inl-adiant-obs').value || '';
            if (!valor) { UI.toast('Informe o valor', 'warning'); return; }
            const data = {
                motoristaId: form.mId.value,
                data: dataVal,
                valor: valor,
                observacao: obs
            };
            if (await DB.save(ENTITIES.ADIANTAMENTOS, data)) {
                UI.toast('Adiantamento salvo!', 'success');
                document.getElementById('inl-adiant-valor').value = '';
                document.getElementById('inl-adiant-obs').value = '';
                document.getElementById('inline-adiant-form').classList.add('hidden');
                this.recalc();
            }
        },
        async saveInlineAdjust() {
            const form = document.getElementById('form-pay');
            if (!form || !form.mId.value) return;
            const dataVal = document.getElementById('inl-adjust-data').value;
            const tipo = document.getElementById('inl-adjust-tipo').value;
            const valor = parseFloat(document.getElementById('inl-adjust-valor').value || 0);
            const obs = document.getElementById('inl-adjust-obs').value || '';
            if (!valor) { UI.toast('Informe o valor', 'warning'); return; }
            const data = {
                motoristaId: form.mId.value,
                data: dataVal,
                tipo: tipo,
                valor: valor,
                observacao: obs
            };
            if (await DB.save(ENTITIES.DRIVER_ADJUSTMENTS, data)) {
                UI.toast('Ajuste salvo!', 'success');
                document.getElementById('inl-adjust-valor').value = '';
                document.getElementById('inl-adjust-obs').value = '';
                document.getElementById('inline-adjust-form').classList.add('hidden');
                this.recalc();
            }
        },
        calcTotal() {
            const form = document.getElementById('form-pay');
            if (form) {
                const bruto = parseFloat(form.bruto.value || 0);
                const adiant = parseFloat(form.adiant.value || 0);
                const pnr = parseFloat(form.pnr.value || 0);
                const desc = parseFloat(form.desc.value || 0);
                const extra = parseFloat(form.extra.value || 0);
                form.total.value = (bruto - adiant - pnr - desc + extra).toFixed(2);
            }
        },
        async save() {
            const form = document.getElementById('form-pay');
            const mes = parseInt(form.mes.value);
            const ano = parseInt(form.ano.value);
            const tipo = form.tipo.value;
            const lastDay = Utils.lastDayOfMonth(ano, mes);
            const periodoInicio = tipo === 'quinzenal' ? (form.quinzena.value === '1' ? `${ano}-${String(mes).padStart(2,'0')}-01` : `${ano}-${String(mes).padStart(2,'0')}-16`) : `${ano}-${String(mes).padStart(2,'0')}-01`;
            const periodoFim = tipo === 'quinzenal' ? (form.quinzena.value === '1' ? `${ano}-${String(mes).padStart(2,'0')}-15` : `${ano}-${String(mes).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`) : `${ano}-${String(mes).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
            const rotas = DB.getAll(ENTITIES.ROUTES).filter(r => r.motoristaId === form.mId.value && (r.data >= periodoInicio && r.data <= periodoFim));
            const kmTotal = rotas.reduce((acc, r) => acc + parseFloat(r.km || 0), 0);
            const freteTotal = rotas.reduce((acc, r) => acc + parseFloat(r.valorFrete || 0), 0);
            const diasSet = new Set(rotas.map(r => r.data));
            const diasList = Array.from(diasSet).sort();
            const driver = DB.getById(ENTITIES.DRIVERS, form.mId.value);
            const diariaBase = parseFloat(driver?.valorDiaria || 0);
            const diariaDomingo = Utils.getSundayRate(driver);
            let diasDomingo = 0;
            let valorBrutoDiarias = 0;
            for (const dateStr of diasList) {
                if (Utils.isSunday(dateStr) && diariaDomingo > 0) {
                    diasDomingo += 1;
                    valorBrutoDiarias += diariaDomingo;
                } else {
                    valorBrutoDiarias += diariaBase;
                }
            }
            const data = { 
                motoristaId: form.mId.value, 
                mes, 
                ano, 
                periodoTipo: tipo,
                periodoInicio,
                periodoFim,
                diasTrabalhados: diasList.length, 
                diasDomingo,
                valorDiaria: diariaBase,
                valorDomingo: diariaDomingo,
                valorBrutoDiarias,
                adiantamentos: parseFloat(form.adiant.value || 0),
                pnr: parseFloat(form.pnr.value || 0),
                descontos: parseFloat(form.desc.value || 0),
                extras: parseFloat(form.extra.value || 0),
                rotasCount: rotas.length,
                kmTotal,
                freteTotal,
                valorFinal: parseFloat(form.total.value || 0), 
                pago: 0 
            };
            await DB.save(ENTITIES.DRIVER_PAYMENTS, data); UI.toast('Fechamento realizado!', 'success'); UI.closeModal(); this.render();
        },
        exportPDF(id) {
            const p = DB.getById(ENTITIES.DRIVER_PAYMENTS, id);
            if (!p) return;
            const driver = DB.getById(ENTITIES.DRIVERS, p.motoristaId);
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const headers = ['Item', 'Valor'];
            const bruto = parseFloat(p.valorBrutoDiarias || 0) || (parseFloat(p.diasTrabalhados || 0) * parseFloat(p.valorDiaria || 0));
            const rows = [
                ['Motorista', driver?.nome || 'N/A'],
                ['Período', p.periodoInicio && p.periodoFim ? `${Utils.formatDate(p.periodoInicio)} até ${Utils.formatDate(p.periodoFim)}` : `${p.mes}/${p.ano}`],
                ['Rotas', String(p.rotasCount || 0)],
                ['KM Total', `${parseFloat(p.kmTotal || 0).toLocaleString()} km`],
                ['Dias Trabalhados', String(p.diasTrabalhados || 0)],
                ['Diária base', Utils.formatCurrency(p.valorDiaria || 0)],
                ['Domingos', `${parseInt(p.diasDomingo || 0, 10) || 0} dia(s) • ${Utils.formatCurrency(p.valorDomingo || 0)}`],
                ['Valor diárias', Utils.formatCurrency(bruto)],
                ['Adiantamentos', Utils.formatCurrency(p.adiantamentos || 0)],
                ['PNR', Utils.formatCurrency(p.pnr || 0)],
                ['Descontos', Utils.formatCurrency(p.descontos || 0)],
                ['Extras', Utils.formatCurrency(p.extras || 0)],
                ['Total a Pagar', Utils.formatCurrency(p.valorFinal || 0)]
            ];
            doc.setFontSize(16);
            doc.text(`Resumo de Pagamento`, 14, 18);
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text(`Gerado em: ${new Date().toLocaleString()}`, 14, 26);
            doc.setTextColor(0);
            doc.autoTable({
                head: [headers],
                body: rows,
                startY: 32,
                theme: 'grid',
                headStyles: { fillColor: [30, 41, 59] },
                alternateRowStyles: { fillColor: [248, 250, 252] }
            });
            const y = (doc.lastAutoTable?.finalY || 32) + 18;
            doc.setDrawColor(120);
            doc.line(14, y, 90, y);
            doc.line(120, y, 196, y);
            doc.setFontSize(10);
            doc.setTextColor(80);
            doc.text('Assinatura do Motorista', 14, y + 6);
            doc.text('Assinatura da Empresa', 120, y + 6);
            const safeName = (driver?.nome || 'motorista').toLowerCase().replace(/[^a-z0-9]+/gi, '_');
            doc.save(`resumo_pagamento_${safeName}_${p.periodoInicio || `${p.mes}_${p.ano}`}.pdf`);
        },
        async toggle(id) {
            const item = DB.getById(ENTITIES.DRIVER_PAYMENTS, id);
            if (item) {
                item.pago = item.pago ? 0 : 1;
                await DB.save(ENTITIES.DRIVER_PAYMENTS, item);
                UI.toast(`Status alterado para ${item.pago ? 'Pago' : 'Pendente'}`, 'info');
                this.render();
            }
        },
        async delete(id) { if (confirm('Excluir?')) { await DB.delete(ENTITIES.DRIVER_PAYMENTS, id); this.render(); } }
    },
    invoices: {
        render() {
            const list = DB.getAll(ENTITIES.INVOICES);
            const container = document.getElementById('page-invoices');
            container.innerHTML = `
                <div class="flex justify-between items-center mb-8"><div><h3 class="text-xl font-bold text-slate-800">Notas Fiscais</h3><p class="text-slate-500 text-sm">${list.length} arquivos</p></div><button onclick="Pages.invoices.openForm()" class="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold"><i class="fa-solid fa-camera"></i> Escanear</button></div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    ${list.map(inv => `
                        <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div class="h-44 bg-slate-100 flex items-center justify-center cursor-pointer" onclick="document.getElementById('full-image').src='${inv.foto}'; document.getElementById('image-modal').classList.remove('hidden')">
                                ${inv.foto ? `<img src="${inv.foto}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-file-invoice text-5xl text-slate-200"></i>`}
                            </div>
                            <div class="p-4"><h4 class="font-bold text-slate-800">${inv.descricao}</h4><p class="text-xs text-slate-500">Nº ${inv.numero} • ${inv.fornecedor}</p><div class="flex justify-between items-center mt-4 pt-3 border-t"><span class="font-black text-slate-700">${Utils.formatCurrency(inv.valor)}</span><button onclick="Pages.invoices.delete('${inv.id}')" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-trash-can"></i></button></div></div>
                        </div>
                    `).join('') || '<p class="col-span-full text-center text-slate-400 py-12">Sem notas.</p>'}
                </div>
            `;
        },
        openForm() {
            const html = `
                <form id="form-inv" class="space-y-4">
                    <input type="file" accept="image/*" capture="environment" onchange="const r=new FileReader(); r.onload=e=>document.getElementById('f-base').value=e.target.result; r.readAsDataURL(this.files[0])" class="w-full text-sm">
                    <input type="hidden" id="f-base">
                    <input type="text" name="desc" placeholder="Descrição" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <div class="grid grid-cols-2 gap-4">
                        <input type="number" name="val" step="0.01" placeholder="Valor" required class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        <input type="text" name="num" placeholder="Número" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    </div>
                </form>
            `;
            UI.openModal('Nova Nota', html, `<button onclick="UI.closeModal()" class="text-slate-500 font-bold px-4 py-2">Cancelar</button><button onclick="Pages.invoices.save()" class="bg-blue-600 text-white font-bold px-6 py-2 rounded-lg">Salvar</button>`);
        },
        async save() {
            const form = document.getElementById('form-inv');
            const data = { foto: document.getElementById('f-base').value, descricao: form.desc.value, valor: parseFloat(form.val.value), numero: form.num.value, data: new Date().toISOString().split('T')[0], tipo: 'Geral', fornecedor: 'N/A' };
            await DB.save(ENTITIES.INVOICES, data); UI.toast('Arquivado!', 'success'); UI.closeModal(); this.render();
        },
        async delete(id) { if (confirm('Excluir?')) { await DB.delete(ENTITIES.INVOICES, id); this.render(); } }
    },
    reports: {
        activeTab: 'daily',
        currentDate: new Date().toISOString().split('T')[0],
        currentMonth: new Date().getMonth() + 1,
        currentYear: new Date().getFullYear(),

        render() {
            const container = document.getElementById('page-reports');
            container.innerHTML = `
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 no-print">
                    <div class="flex bg-white p-1 rounded-xl shadow-sm border border-slate-200">
                        <button onclick="Pages.reports.setTab('daily')" class="px-6 py-2 rounded-lg text-sm font-bold transition-all ${this.activeTab === 'daily' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}">Diário</button>
                        <button onclick="Pages.reports.setTab('monthly')" class="px-6 py-2 rounded-lg text-sm font-bold transition-all ${this.activeTab === 'monthly' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}">Mensal</button>
                    </div>
                    <div class="flex items-center gap-3">
                        ${this.renderFilters()}
                        <div class="flex gap-2">
                            <button onclick="window.print()" class="bg-slate-100 text-slate-600 px-4 py-2.5 rounded-xl font-bold hover:bg-slate-200 transition-all flex items-center gap-2">
                                <i class="fa-solid fa-print"></i>
                            </button>
                            <button onclick="Pages.reports.exportPDF()" class="bg-rose-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-rose-700 transition-all flex items-center gap-2">
                                <i class="fa-solid fa-file-pdf"></i> Exportar PDF
                            </button>
                        </div>
                    </div>
                </div>

                <div id="report-content" class="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 min-h-[1000px]">
                    ${this.activeTab === 'daily' ? this.renderDaily() : this.renderMonthly()}
                </div>
            `;
        },

        renderFilters() {
            if (this.activeTab === 'daily') {
                return `<input type="date" value="${this.currentDate}" onchange="Pages.reports.currentDate = this.value; Pages.reports.render()" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none">`;
            } else {
                return `
                    <select onchange="Pages.reports.currentMonth = parseInt(this.value); Pages.reports.render()" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none">
                        ${Array.from({length: 12}, (_, i) => `<option value="${i+1}" ${this.currentMonth === i+1 ? 'selected' : ''}>${Utils.getMonthName(i)}</option>`).join('')}
                    </select>
                    <select onchange="Pages.reports.currentYear = parseInt(this.value); Pages.reports.render()" class="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none">
                        ${[2024, 2025, 2026, 2027].map(y => `<option value="${y}" ${this.currentYear === y ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>
                `;
            }
        },

        setTab(tab) {
            this.activeTab = tab;
            this.render();
        },

        async exportPDF() {
            if (this.activeTab === 'daily') {
                const routes = DB.getAll(ENTITIES.ROUTES).filter(r => r.data === this.currentDate);
                const headers = ['Motorista', 'Veículo', 'Origem', 'Destino', 'KM', 'Frete'];
                const rows = routes.map(r => [
                    DB.getById(ENTITIES.DRIVERS, r.motoristaId)?.nome || '-',
                    DB.getById(ENTITIES.VEHICLES, r.veiculoId)?.placa || '-',
                    r.origem,
                    r.destino,
                    r.km,
                    Utils.formatCurrency(r.valorFrete)
                ]);
                await Utils.exportToPDF(`Relatório Diário - ${this.currentDate}`, headers, rows, `relatorio_diario_${this.currentDate}`);
            } else {
                const monthKey = Utils.makeMonthKey(this.currentYear, this.currentMonth);
                const routes = DB.getAll(ENTITIES.ROUTES).filter(r => Utils.monthKey(r.data) === monthKey);
                const headers = ['Data', 'Motorista', 'Veículo', 'Destino', 'Frete'];
                const rows = routes.map(r => [
                    Utils.formatDate(r.data),
                    DB.getById(ENTITIES.DRIVERS, r.motoristaId)?.nome || '-',
                    DB.getById(ENTITIES.VEHICLES, r.veiculoId)?.placa || '-',
                    r.destino,
                    Utils.formatCurrency(r.valorFrete)
                ]);
                await Utils.exportToPDF(`Relatório Mensal - ${Utils.getMonthName(this.currentMonth-1)}/${this.currentYear}`, headers, rows, `relatorio_mensal_${this.currentMonth}_${this.currentYear}`);
            }
        },

        renderDaily() {
            const routes = DB.getAll(ENTITIES.ROUTES).filter(r => r.data === this.currentDate);
            const fuel = DB.getAll(ENTITIES.FUEL).filter(f => f.data === this.currentDate);
            const totalFrete = routes.reduce((acc, r) => acc + parseFloat(r.valorFrete || 0), 0);
            const totalKm = routes.reduce((acc, r) => acc + parseFloat(r.km || 0), 0);
            const totalFuel = fuel.reduce((acc, f) => acc + parseFloat(f.valorTotal || 0), 0);

            return `
                <div class="text-center border-b pb-8 mb-8">
                    <h1 class="text-3xl font-black text-slate-800 uppercase tracking-tighter">Relatório Diário</h1>
                    <p class="text-slate-500 font-bold mt-2">${Utils.formatFullDate(new Date(this.currentDate + 'T12:00:00'))}</p>
                </div>
                <div class="grid grid-cols-3 gap-6 mb-12">
                    <div class="border p-4 rounded-xl text-center"><p class="text-[10px] font-black uppercase text-slate-400">Receita Fretes</p><p class="text-xl font-bold text-emerald-600">${Utils.formatCurrency(totalFrete)}</p></div>
                    <div class="border p-4 rounded-xl text-center"><p class="text-[10px] font-black uppercase text-slate-400">Km Rodados</p><p class="text-xl font-bold text-slate-800">${totalKm.toLocaleString()} km</p></div>
                    <div class="border p-4 rounded-xl text-center"><p class="text-[10px] font-black uppercase text-slate-400">Despesa Fuel</p><p class="text-xl font-bold text-rose-600">${Utils.formatCurrency(totalFuel)}</p></div>
                </div>
                <div class="space-y-6">
                    <h4 class="font-bold text-slate-700 uppercase text-xs">Rotas do Dia</h4>
                    <table class="w-full text-xs text-left border-collapse">
                        <thead><tr class="bg-slate-50 border-y"><th class="p-3">Motorista</th><th class="p-3">Veículo</th><th class="p-3">Destino</th><th class="p-3 text-right">Frete</th></tr></thead>
                        <tbody>${routes.map(r => `<tr class="border-b"><td class="p-3">${DB.getById(ENTITIES.DRIVERS, r.motoristaId)?.nome || '-'}</td><td class="p-3">${DB.getById(ENTITIES.VEHICLES, r.veiculoId)?.placa || '-'}</td><td class="p-3">${r.destino}</td><td class="p-3 text-right font-bold">${Utils.formatCurrency(parseFloat(r.valorFrete || 0))}</td></tr>`).join('') || '<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Sem registros</td></tr>'}</tbody>
                    </table>
                </div>
            `;
        },

        renderMonthly() {
            const monthKey = Utils.makeMonthKey(this.currentYear, this.currentMonth);
            const routes = DB.getAll(ENTITIES.ROUTES).filter(r => Utils.monthKey(r.data) === monthKey);
            const fuel = DB.getAll(ENTITIES.FUEL).filter(f => Utils.monthKey(f.data) === monthKey);
            const payables = DB.getAll(ENTITIES.PAYABLES).filter(p => Utils.monthKey(p.vencimento) === monthKey);
            const receivables = DB.getAll(ENTITIES.RECEIVABLES).filter(r => Utils.monthKey(r.vencimento) === monthKey);
            
            const totalRevenue = routes.reduce((acc, r) => acc + parseFloat(r.valorFrete || 0), 0);
            const totalFuel = fuel.reduce((acc, f) => acc + parseFloat(f.valorTotal || 0), 0);
            const totalOtherExp = payables.reduce((acc, p) => acc + parseFloat(p.valor || 0), 0);
            const totalOtherRec = receivables.reduce((acc, r) => acc + parseFloat(r.valor || 0), 0);
            const result = (totalRevenue + totalOtherRec) - (totalFuel + totalOtherExp);

            return `
                <div class="text-center border-b pb-8 mb-8">
                    <h1 class="text-3xl font-black text-slate-800 uppercase tracking-tighter">Relatório Mensal</h1>
                    <p class="text-slate-500 font-bold mt-2 uppercase">${Utils.getMonthName(this.currentMonth-1)} / ${this.currentYear}</p>
                </div>
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                    <div class="bg-blue-50 p-4 rounded-xl border border-blue-100"><p class="text-[9px] font-black text-blue-400 uppercase">Receita Operacional</p><p class="text-xl font-bold text-blue-700">${Utils.formatCurrency(totalRevenue)}</p></div>
                    <div class="bg-rose-50 p-4 rounded-xl border border-rose-100"><p class="text-[9px] font-black text-rose-400 uppercase">Despesa Fuel</p><p class="text-xl font-bold text-rose-700">${Utils.formatCurrency(totalFuel)}</p></div>
                    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200"><p class="text-[9px] font-black text-slate-400 uppercase">Outras Despesas</p><p class="text-xl font-bold text-slate-700">${Utils.formatCurrency(totalOtherExp)}</p></div>
                    <div class="bg-emerald-50 p-4 rounded-xl border border-emerald-200"><p class="text-[9px] font-black text-emerald-400 uppercase">Resultado Líquido</p><p class="text-xl font-bold text-emerald-700">${Utils.formatCurrency(result)}</p></div>
                </div>
                <div class="space-y-8">
                    <h4 class="font-bold text-slate-700 uppercase text-xs border-b pb-2">Resumo Financeiro Detalhado</h4>
                    <div class="grid grid-cols-2 gap-8 text-sm">
                        <div>
                            <p class="flex justify-between py-1"><span>Receita Fretes:</span> <span class="font-bold text-emerald-600">+ ${Utils.formatCurrency(totalRevenue)}</span></p>
                            <p class="flex justify-between py-1"><span>Outras Receitas:</span> <span class="font-bold text-emerald-600">+ ${Utils.formatCurrency(totalOtherRec)}</span></p>
                            <p class="flex justify-between py-1 border-t mt-1 font-black"><span>TOTAL RECEITAS:</span> <span>${Utils.formatCurrency(totalRevenue + totalOtherRec)}</span></p>
                        </div>
                        <div>
                            <p class="flex justify-between py-1"><span>Despesa Combustível:</span> <span class="font-bold text-rose-600">- ${Utils.formatCurrency(totalFuel)}</span></p>
                            <p class="flex justify-between py-1"><span>Despesas Administrativas:</span> <span class="font-bold text-rose-600">- ${Utils.formatCurrency(totalOtherExp)}</span></p>
                            <p class="flex justify-between py-1 border-t mt-1 font-black"><span>TOTAL DESPESAS:</span> <span>${Utils.formatCurrency(totalFuel + totalOtherExp)}</span></p>
                        </div>
                    </div>
                </div>
                <div class="mt-12 pt-8 border-t text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">TransportManager v1 • Sistema de Gestão Interna</div>
            `;
        }
    }
};

// --- INITIALIZATION ---
window.seedDatabase = async () => { 
    if (confirm('Deseja resetar o banco de dados com dados de exemplo? Isso apagará dados existentes.')) {
        // We'll redirect to a script that seeds the API
        window.location.href = 'seed.html'; 
    } 
};
document.addEventListener('DOMContentLoaded', () => UI.init());
function navigate(p) { UI.navigate(p); }
