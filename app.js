/**
 * Orders App:
 * 1) Лендинг (навигация, CTA, отображение года)
 * 2) Черновой модуль учета заказов (ленивая инициализация)
 */

(function () {
  "use strict";

  function initLanding() {
    var currentYear = document.getElementById("current-year");
    if (currentYear) {
      currentYear.textContent = String(new Date().getFullYear());
    }

    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener("click", function (event) {
        var href = link.getAttribute("href");
        if (!href || href.length < 2) return;
        var target = document.querySelector(href);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  var ordersInitialized = false;

  function mountOrdersModule() {
    var moduleEl = document.getElementById("orders-module");
    var openBtn = document.getElementById("open-orders-btn");
    if (!moduleEl) return;

    moduleEl.classList.remove("hidden");
    if (openBtn) {
      openBtn.disabled = true;
      openBtn.textContent = "Модуль открыт";
    }

    if (!ordersInitialized) {
      initOrdersApp();
      ordersInitialized = true;
    }
  }

  var openOrdersBtn = document.getElementById("open-orders-btn");
  if (openOrdersBtn) {
    openOrdersBtn.addEventListener("click", mountOrdersModule);
  }

  initLanding();
})();

function initOrdersApp() {
  "use strict";

  // --- Константы: ключ хранилища и статусы ---

  /** @type {string} */
  var STORAGE_KEY = "orders-app-v1";

  /** @type {readonly OrderStatus[]} */
  var STATUS_ORDER = ["new", "in_progress", "ready", "shipped"];

  var STATUS_LABELS = {
    new: "Новый",
    in_progress: "В работе",
    ready: "Готов",
    shipped: "Отправлен",
  };

  // --- Типы (JSDoc) ---

  /**
   * @typedef {"new"|"in_progress"|"ready"|"shipped"} OrderStatus
   */

  /**
   * @typedef {Object} LineItem
   * @property {string} id
   * @property {string} name
   */

  /**
   * @typedef {Object} Order
   * @property {string} id
   * @property {string} clientName
   * @property {string} contact
   * @property {number} cost
   * @property {OrderStatus} status
   * @property {string} createdAt
   * @property {LineItem[]} items
   * @property {string|null} receivedDate дата YYYY-MM-DD или null
   * @property {string|null} shippedDate дата YYYY-MM-DD или null
   */

  // --- Состояние ---

  /** @type {Order[]} */
  var orders = [];

  /** @type {string|null} */
  var editingId = null;

  /**
   * Черновик позиций в форме (новый заказ / редактирование)
   * @type {LineItem[]}
   */
  var draftItems = [];

  // --- DOM ---

  var form = document.getElementById("order-form");
  var inputName = document.getElementById("client-name");
  var inputContact = document.getElementById("contact");
  var inputCost = document.getElementById("cost");
  var inputReceivedDate = document.getElementById("received-date");
  var inputShippedDate = document.getElementById("shipped-date");
  var formItemsListEl = document.getElementById("form-items-list");
  var newItemInput = document.getElementById("new-item-input");
  var addItemBtn = document.getElementById("add-item-btn");
  var btnCancelEdit = document.getElementById("form-cancel-edit");
  var filterSelect = document.getElementById("status-filter");
  var listEl = document.getElementById("orders-list");
  var emptyState = document.getElementById("empty-state");

  if (
    !form ||
    !inputName ||
    !inputContact ||
    !inputCost ||
    !inputReceivedDate ||
    !inputShippedDate ||
    !formItemsListEl ||
    !newItemInput ||
    !addItemBtn ||
    !btnCancelEdit ||
    !filterSelect ||
    !listEl ||
    !emptyState
  ) {
    return;
  }

  // --- Утилиты ---

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function parseCost(raw) {
    var n = parseFloat(String(raw).replace(",", "."));
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  }

  /**
   * Проверка строки даты в формате YYYY-MM-DD
   * @param {unknown} v
   * @returns {string|null}
   */
  function sanitizeDateField(v) {
    if (v === null || v === undefined || v === "") return null;
    var s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  }

  /**
   * Отображение даты для пользователя (локальный календарь)
   * @param {string|null} ymd
   * @returns {string}
   */
  function formatDateRu(ymd) {
    if (!ymd) return "";
    var p = ymd.split("-");
    if (p.length !== 3) return ymd;
    var y = Number(p[0]);
    var m = Number(p[1]) - 1;
    var d = Number(p[2]);
    var dt = new Date(y, m, d);
    if (isNaN(dt.getTime())) return ymd;
    return dt.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  /**
   * @param {unknown} x
   * @returns {LineItem|null}
   */
  function normalizeLineItem(x) {
    if (typeof x === "string") {
      var n0 = x.trim();
      if (!n0) return null;
      return { id: generateId(), name: n0.slice(0, 200) };
    }
    if (!x || typeof x !== "object") return null;
    var rec = /** @type {Record<string, unknown>} */ (x);
    var name = String(rec.name || "").trim();
    if (!name) return null;
    var id = typeof rec.id === "string" ? rec.id : generateId();
    return { id: id, name: name.slice(0, 200) };
  }

  /**
   * @param {unknown} row
   * @returns {Order|null}
   */
  function normalizeOrder(row) {
    if (!row || typeof row !== "object") return null;
    var o = /** @type {Record<string, unknown>} */ (row);
    var status = o.status;
    if (
      status !== "new" &&
      status !== "in_progress" &&
      status !== "ready" &&
      status !== "shipped"
    ) {
      status = "new";
    }
    var cost = typeof o.cost === "number" ? o.cost : parseCost(String(o.cost));
    if (!isFinite(cost) || cost < 0) return null;
    var id = typeof o.id === "string" ? o.id : generateId();
    var clientName = String(o.clientName || "").trim();
    var contact = String(o.contact || "").trim();
    if (!clientName || !contact) return null;

    /** @type {LineItem[]} */
    var items = [];
    if (Array.isArray(o.items)) {
      o.items.forEach(function (it) {
        var li = normalizeLineItem(it);
        if (li) items.push(li);
      });
    }

    return {
      id: id,
      clientName: clientName.slice(0, 120),
      contact: contact.slice(0, 200),
      cost: cost,
      status: /** @type {OrderStatus} */ (status),
      createdAt:
        typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
      items: items,
      receivedDate: sanitizeDateField(o.receivedDate),
      shippedDate: sanitizeDateField(o.shippedDate),
    };
  }

  function loadOrders() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data
        .map(normalizeOrder)
        .filter(function (o) {
          return o !== null;
        });
    } catch (e) {
      return [];
    }
  }

  function saveOrders() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    } catch (e) {
      alert("Не удалось сохранить данные. Проверьте место в хранилище браузера.");
    }
  }

  function getFilterValue() {
    var v = filterSelect.value;
    if (
      v === "new" ||
      v === "in_progress" ||
      v === "ready" ||
      v === "shipped" ||
      v === "all"
    ) {
      return v;
    }
    return "all";
  }

  function getFilteredOrders() {
    var f = getFilterValue();
    if (f === "all") return orders.slice();
    return orders.filter(function (o) {
      return o.status === f;
    });
  }

  // --- Черновик товаров в форме ---

  function cloneItems(arr) {
    return arr.map(function (it) {
      return { id: it.id, name: it.name };
    });
  }

  /** Отрисовка списка позиций в форме */
  function renderDraftItems() {
    formItemsListEl.innerHTML = "";
    draftItems.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "form-item-row";
      var span = document.createElement("span");
      span.className = "form-item-row__name";
      span.textContent = item.name;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost btn-sm";
      btn.textContent = "Удалить";
      btn.addEventListener("click", function () {
        draftItems = draftItems.filter(function (x) {
          return x.id !== item.id;
        });
        renderDraftItems();
      });
      li.appendChild(span);
      li.appendChild(btn);
      formItemsListEl.appendChild(li);
    });
  }

  function addDraftItem() {
    var name = newItemInput.value.trim();
    if (!name) return;
    draftItems.push({ id: generateId(), name: name.slice(0, 200) });
    newItemInput.value = "";
    newItemInput.focus();
    renderDraftItems();
  }

  // --- Рендер списка заказов ---

  function toggleEmpty(isEmpty) {
    emptyState.classList.toggle("hidden", !isEmpty);
    listEl.classList.toggle("hidden", isEmpty);
  }

  function buildStatusButtons(order) {
    var wrap = document.createElement("div");
    wrap.className = "order-item__status-actions";

    STATUS_ORDER.forEach(function (st) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary btn-sm";
      btn.textContent = STATUS_LABELS[st];
      if (order.status === st) btn.classList.add("is-active");
      btn.addEventListener("click", function () {
        setOrderStatus(order.id, st);
      });
      wrap.appendChild(btn);
    });

    return wrap;
  }

  /**
   * Блок дат на карточке
   * @param {Order} order
   */
  function buildDatesBlock(order) {
    var hasReceived = !!order.receivedDate;
    var hasShipped = !!order.shippedDate;
    if (!hasReceived && !hasShipped) return null;

    var ul = document.createElement("ul");
    ul.className = "order-item__dates";
    if (hasReceived) {
      var li1 = document.createElement("li");
      li1.innerHTML =
        "Поступление: <span>" +
        formatDateRu(order.receivedDate) +
        "</span>";
      ul.appendChild(li1);
    }
    if (hasShipped) {
      var li2 = document.createElement("li");
      li2.innerHTML =
        "Отправление: <span>" + formatDateRu(order.shippedDate) + "</span>";
      ul.appendChild(li2);
    }
    return ul;
  }

  /**
   * Секция товаров на карточке: список, удаление, быстрое добавление
   * @param {Order} order
   */
  function buildProductsBlock(order) {
    var section = document.createElement("div");
    section.className = "order-item__products";

    var title = document.createElement("p");
    title.className = "order-item__products-title";
    title.textContent = "Товары";
    section.appendChild(title);

    if (order.items.length === 0) {
      var empty = document.createElement("p");
      empty.className = "order-item__products-empty";
      empty.textContent = "Позиции не указаны.";
      section.appendChild(empty);
    } else {
      var ul = document.createElement("ul");
      ul.className = "order-item__products-ul";
      order.items.forEach(function (it) {
        var li = document.createElement("li");
        li.className = "order-item__product-row";

        var nameSpan = document.createElement("span");
        nameSpan.className = "order-item__product-name";
        nameSpan.textContent = it.name;

        var btnRm = document.createElement("button");
        btnRm.type = "button";
        btnRm.className = "btn btn-ghost btn-sm";
        btnRm.textContent = "Удалить";
        btnRm.setAttribute("aria-label", "Удалить товар «" + it.name + "»");
        btnRm.addEventListener("click", function () {
          removeOrderLineItem(order.id, it.id);
        });

        li.appendChild(nameSpan);
        li.appendChild(btnRm);
        ul.appendChild(li);
      });
      section.appendChild(ul);
    }

    var addRow = document.createElement("div");
    addRow.className = "order-item__card-add";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.maxLength = 200;
    inp.placeholder = "Добавить товар…";
    inp.setAttribute("aria-label", "Название товара для добавления");
    var btnAdd = document.createElement("button");
    btnAdd.type = "button";
    btnAdd.className = "btn btn-secondary btn-sm";
    btnAdd.textContent = "Добавить";
    btnAdd.addEventListener("click", function () {
      addOrderLineItemFromCard(order.id, inp);
    });
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addOrderLineItemFromCard(order.id, inp);
      }
    });
    addRow.appendChild(inp);
    addRow.appendChild(btnAdd);
    section.appendChild(addRow);

    return section;
  }

  function createOrderElement(order) {
    var li = document.createElement("li");
    li.className = "order-item order-item--" + order.status;
    li.dataset.id = order.id;

    var top = document.createElement("div");
    top.className = "order-item__top";

    var h3 = document.createElement("h3");
    h3.className = "order-item__client";
    h3.textContent = order.clientName;

    var badge = document.createElement("span");
    badge.className = "order-item__badge";
    badge.textContent = STATUS_LABELS[order.status];

    top.appendChild(h3);
    top.appendChild(badge);

    var meta = document.createElement("p");
    meta.className = "order-item__meta";
    meta.textContent = order.contact;

    var cost = document.createElement("p");
    cost.className = "order-item__cost";
    cost.textContent = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: "RUB",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(order.cost);

    var datesEl = buildDatesBlock(order);

    var actions = document.createElement("div");
    actions.className = "order-item__row-actions";

    var btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn btn-ghost btn-sm";
    btnEdit.textContent = "Редактировать";
    btnEdit.addEventListener("click", function () {
      startEdit(order.id);
    });

    var btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "btn btn-danger btn-sm";
    btnDel.textContent = "Удалить";
    btnDel.addEventListener("click", function () {
      deleteOrder(order.id);
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);

    li.appendChild(top);
    li.appendChild(meta);
    li.appendChild(cost);
    if (datesEl) li.appendChild(datesEl);
    li.appendChild(buildProductsBlock(order));
    li.appendChild(buildStatusButtons(order));
    li.appendChild(actions);

    return li;
  }

  function render() {
    var filtered = getFilteredOrders();
    listEl.innerHTML = "";

    if (orders.length === 0) {
      toggleEmpty(true);
      return;
    }

    toggleEmpty(false);

    if (filtered.length === 0) {
      var liEmpty = document.createElement("li");
      liEmpty.className = "orders-list__filter-empty";
      liEmpty.textContent = "Нет заказов с выбранным статусом.";
      listEl.appendChild(liEmpty);
      return;
    }

    filtered.forEach(function (o) {
      listEl.appendChild(createOrderElement(o));
    });
  }

  // --- Операции ---

  function setOrderStatus(id, status) {
    var o = orders.find(function (x) {
      return x.id === id;
    });
    if (!o) return;
    o.status = status;
    saveOrders();
    render();
  }

  function deleteOrder(id) {
    if (!confirm("Удалить этот заказ?")) return;
    orders = orders.filter(function (x) {
      return x.id !== id;
    });
    if (editingId === id) cancelEdit();
    saveOrders();
    render();
  }

  /**
   * Удаление позиции с карточки
   */
  function removeOrderLineItem(orderId, itemId) {
    var o = orders.find(function (x) {
      return x.id === orderId;
    });
    if (!o) return;
    o.items = o.items.filter(function (x) {
      return x.id !== itemId;
    });
    saveOrders();
    render();
  }

  /**
   * Добавление позиции с карточки
   */
  function addOrderLineItemFromCard(orderId, inputEl) {
    var name = inputEl.value.trim();
    if (!name) return;
    var o = orders.find(function (x) {
      return x.id === orderId;
    });
    if (!o) return;
    o.items.push({ id: generateId(), name: name.slice(0, 200) });
    inputEl.value = "";
    saveOrders();
    render();
  }

  function startEdit(id) {
    var o = orders.find(function (x) {
      return x.id === id;
    });
    if (!o) return;
    editingId = id;
    inputName.value = o.clientName;
    inputContact.value = o.contact;
    inputCost.value = String(o.cost);
    inputReceivedDate.value = o.receivedDate || "";
    inputShippedDate.value = o.shippedDate || "";
    draftItems = cloneItems(o.items);
    renderDraftItems();
    btnCancelEdit.classList.remove("hidden");
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Сохранить изменения";
    inputName.focus();
  }

  function cancelEdit() {
    editingId = null;
    draftItems = [];
    renderDraftItems();
    newItemInput.value = "";
    form.reset();
    btnCancelEdit.classList.add("hidden");
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Добавить заказ";
  }

  function readDatesFromForm() {
    return {
      receivedDate: sanitizeDateField(inputReceivedDate.value),
      shippedDate: sanitizeDateField(inputShippedDate.value),
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    var name = inputName.value.trim();
    var contact = inputContact.value.trim();
    var cost = parseCost(inputCost.value);
    var dates = readDatesFromForm();

    if (!name || !contact) {
      alert("Укажите имя клиента и контакт.");
      return;
    }
    if (!isFinite(cost)) {
      alert("Укажите корректную стоимость.");
      return;
    }

    var itemsSnapshot = cloneItems(draftItems);

    if (editingId) {
      var o = orders.find(function (x) {
        return x.id === editingId;
      });
      if (o) {
        o.clientName = name.slice(0, 120);
        o.contact = contact.slice(0, 200);
        o.cost = cost;
        o.items = itemsSnapshot;
        o.receivedDate = dates.receivedDate;
        o.shippedDate = dates.shippedDate;
      }
      cancelEdit();
    } else {
      orders.push({
        id: generateId(),
        clientName: name.slice(0, 120),
        contact: contact.slice(0, 200),
        cost: cost,
        status: "new",
        createdAt: new Date().toISOString(),
        items: itemsSnapshot,
        receivedDate: dates.receivedDate,
        shippedDate: dates.shippedDate,
      });
      draftItems = [];
      renderDraftItems();
      newItemInput.value = "";
      form.reset();
    }

    saveOrders();
    render();
  }

  function init() {
    orders = loadOrders();
    render();
    renderDraftItems();

    form.addEventListener("submit", onSubmit);
    btnCancelEdit.addEventListener("click", cancelEdit);
    filterSelect.addEventListener("change", render);
    addItemBtn.addEventListener("click", addDraftItem);
    newItemInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addDraftItem();
      }
    });
  }

  init();
}
