const mockSockets = [];
const mockIO = { on: jest.fn(), in: jest.fn(() => ({ fetchSockets: async () => mockSockets.filter(s => s.joined) })) };
jest.mock('socket.io', () => ({ Server: jest.fn(() => mockIO) }));
jest.mock('../src/config/db', () => ({ connectToDatabase: jest.fn(async () => {}) }));
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/RevokedToken', () => ({ exists: jest.fn() }));
const User = require('../src/models/User');
const Revoked = require('../src/models/RevokedToken');
const { initSocket, emitAdminMetrics } = require('../src/utils/socket');
const { signToken } = require('../src/utils/jwt');
const tick = () => new Promise(resolve => setImmediate(resolve));
function makeSocket() {
  const handlers = {};
  const socket = { data: {}, handshake: { auth: {}, headers: {} }, joined: false,
    on: (event, handler) => { handlers[event] = handler; }, emit: jest.fn(),
    join: () => { socket.joined = true; }, leave: () => { socket.joined = false; }, handlers };
  mockSockets.push(socket); return socket;
}
beforeEach(() => { mockSockets.length = 0; jest.clearAllMocks(); Revoked.exists.mockResolvedValue(false); });
test('unauthenticated and church administrators cannot receive global admin metrics', async () => {
  initSocket({});
  const connect = mockIO.on.mock.calls.find(([event]) => event === 'connection')[1];
  const anonymous = makeSocket(); connect(anonymous);
  await anonymous.handlers['join:admin']({});
  User.findById.mockResolvedValue({ role: 'church_admin' });
  const church = makeSocket(); connect(church);
  await church.handlers['join:admin']({ token: signToken({ id: 'church', role: 'church_admin' }).token });
  emitAdminMetrics({ confidential: true }); await tick();
  expect(anonymous.emit.mock.calls.some(([event]) => event === 'admin:metrics')).toBe(false);
  expect(church.emit.mock.calls.some(([event]) => event === 'admin:metrics')).toBe(false);
});
test('revoking a token removes its live admin subscription before the next emission', async () => {
  initSocket({});
  const connect = mockIO.on.mock.calls.find(([event]) => event === 'connection')[1];
  User.findById.mockResolvedValue({ role: 'admin' });
  const admin = makeSocket(); connect(admin);
  await admin.handlers['join:admin']({ token: signToken({ id: 'admin', role: 'admin' }).token });
  emitAdminMetrics({ count: 1 }); await tick();
  expect(admin.emit).toHaveBeenCalledWith('admin:metrics', { count: 1 });
  admin.emit.mockClear(); Revoked.exists.mockResolvedValue(true);
  emitAdminMetrics({ count: 2 }); await tick();
  expect(admin.emit).not.toHaveBeenCalledWith('admin:metrics', { count: 2 });
  expect(admin.joined).toBe(false);
});
