// Component state capture — auto-detect React/Vue, snapshot component tree
// eslint-disable-next-line no-unused-vars
function createComponentStateCapture(postLog) {
  let framework = null;

  function detectFramework() {
    try {
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size > 0) return 'react';
      if (document.querySelector('[data-reactroot]') || document.querySelector('#__next')) return 'react';
    } catch (_) {}
    try {
      if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) return 'vue';
      if (document.querySelector('[data-v-]')) return 'vue';
    } catch (_) {}
    return null;
  }

  function summarizeObject(obj, maxKeys) {
    if (!obj || typeof obj !== 'object') return null;
    const result = {};
    const keys = Object.keys(obj).slice(0, maxKeys || 5);
    for (const key of keys) {
      if (key.startsWith('__') || key.startsWith('$$')) continue;
      try {
        const val = obj[key];
        if (typeof val === 'function') { result[key] = '[Function]'; }
        else if (val === null) { result[key] = 'null'; }
        else if (val === undefined) { result[key] = 'undefined'; }
        else if (Array.isArray(val)) { result[key] = `[Array(${val.length})]`; }
        else if (typeof val === 'object') { result[key] = '[Object]'; }
        else { result[key] = String(val).substring(0, 100); }
      } catch (_) {
        result[key] = '[error reading]';
      }
    }
    return result;
  }

  // --- React tree walker ---
  function getReactTree(rootEl, maxDepth) {
    const fiberKey = Object.keys(rootEl).find((k) => k.startsWith('__reactFiber$') || k.startsWith('_reactFiber$'));
    if (!fiberKey) return null;
    return walkFiber(rootEl[fiberKey], 0, maxDepth || 5);
  }

  function walkFiber(fiber, depth, maxDepth) {
    if (!fiber || depth >= maxDepth) return null;

    const isComponent = typeof fiber.type === 'function' || (typeof fiber.type === 'object' && fiber.type !== null);
    const node = isComponent ? {
      name: fiber.type?.displayName || fiber.type?.name || 'Anonymous',
      props: summarizeObject(fiber.memoizedProps, 5),
      state: fiber.memoizedState ? summarizeState(fiber.memoizedState) : null,
      children: [],
    } : null;

    let child = fiber.child;
    while (child) {
      try {
        const childNode = walkFiber(child, node ? depth + 1 : depth, maxDepth);
        if (childNode && node) node.children.push(childNode);
      } catch (_) {}
      child = child.sibling;
    }

    return node;
  }

  function summarizeState(memoizedState) {
    // React hooks store state as a linked list
    if (memoizedState && typeof memoizedState === 'object' && 'memoizedState' in memoizedState) {
      const states = {};
      let hook = memoizedState;
      let i = 0;
      while (hook && i < 5) {
        const val = hook.memoizedState;
        if (val !== undefined && typeof val !== 'function') {
          if (val === null) states[`hook_${i}`] = 'null';
          else if (Array.isArray(val)) states[`hook_${i}`] = `[Array(${val.length})]`;
          else if (typeof val === 'object') states[`hook_${i}`] = '[Object]';
          else states[`hook_${i}`] = String(val).substring(0, 100);
        }
        hook = hook.next;
        i++;
      }
      return Object.keys(states).length > 0 ? states : null;
    }
    return summarizeObject(memoizedState, 5);
  }

  // --- Vue tree walker ---
  function getVueTree(rootEl, maxDepth) {
    // Vue 3
    const app = rootEl.__vue_app__;
    if (app && app._instance) return walkVue3(app._instance, 0, maxDepth || 5);
    // Vue 2
    const vm = rootEl.__vue__;
    if (vm) return walkVue2(vm, 0, maxDepth || 5);
    return null;
  }

  function walkVue3(instance, depth, maxDepth) {
    if (!instance || depth >= maxDepth) return null;
    try {
      const node = {
        name: instance.type?.name || instance.type?.__name || 'Anonymous',
        props: summarizeObject(instance.props, 5),
        state: summarizeObject(instance.setupState || instance.data, 5),
        children: [],
      };
      const subtree = instance.subTree;
      if (subtree?.children && Array.isArray(subtree.children)) {
        for (const child of subtree.children) {
          if (child?.component) {
            const cn = walkVue3(child.component, depth + 1, maxDepth);
            if (cn) node.children.push(cn);
          }
        }
      }
      return node;
    } catch (_) {
      return null;
    }
  }

  function walkVue2(vm, depth, maxDepth) {
    if (!vm || depth >= maxDepth) return null;
    try {
      const node = {
        name: vm.$options?.name || vm.$options?._componentTag || 'Anonymous',
        props: summarizeObject(vm.$props, 5),
        state: summarizeObject(vm.$data, 5),
        children: [],
      };
      if (vm.$children) {
        for (const child of vm.$children.slice(0, 10)) {
          const cn = walkVue2(child, depth + 1, maxDepth);
          if (cn) node.children.push(cn);
        }
      }
      return node;
    } catch (_) {
      return null;
    }
  }

  function findRootElement() {
    return document.getElementById('root')
      || document.getElementById('app')
      || document.getElementById('__next')
      || document.body?.firstElementChild;
  }

  function start() {
    // Delay detection to let frameworks initialize
    setTimeout(() => {
      framework = detectFramework();
      if (framework) {
        postLog('state', {
          timestamp: new Date().toISOString(),
          type: 'framework-detected',
          framework,
        });
      }
    }, 1000);
  }

  function snapshot() {
    if (!framework) {
      framework = detectFramework();
      if (!framework) return null;
    }
    const root = findRootElement();
    if (!root) return null;

    try {
      const tree = framework === 'react' ? getReactTree(root, 5) : getVueTree(root, 5);
      if (tree) {
        postLog('state', {
          timestamp: new Date().toISOString(),
          type: 'component-snapshot',
          framework,
          tree,
        });
      }
      return tree;
    } catch (_) {
      return null;
    }
  }

  function stop() {
    framework = null;
  }

  return { start, stop, snapshot };
}
