const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const dgram = require('node:dgram');
const gateway = require('../scripts/zalo_call_gateway');

test('transport replies cannot connect a ringing call; valid remote audio can', async () => {
  const original = dgram.createSocket;
  const socket = new EventEmitter();
  socket.bind = (_, cb) => cb();
  socket.send = () => {};
  socket.close = () => {};
  dgram.createSocket = () => socket;
  const session = new gateway.ZaloCallGatewaySession({sessionId:'test', accountId:'acc',callId:123,calleeId:'customer',api:{}});
  session.status = 'ringing';
  session.sendHandshakeFrame = () => {};
  try {
    await session.initUdpRelay({rtpIP:'127.0.0.1:4200'});
    const source = {address:'127.0.0.1',port:4200};
    const audio = gateway.buildRtpPacket(Buffer.from([0xf8,0xff,0xfe]), {seq:1,timestamp:960,ssrc:77});
    for (const packet of [Buffer.from('49$handshake$'), Buffer.alloc(24),
      gateway.buildRtpPacket(Buffer.from('control'),{seq:1,timestamp:0,ssrc:77,payloadType:72}),
      gateway.buildRtpPacket(Buffer.alloc(0),{seq:1,timestamp:0,ssrc:77}),
      gateway.buildRtpPacket(Buffer.from('echo'),{seq:1,timestamp:0,ssrc:session.ssrc})]) {
      socket.emit('message',packet,source);
    }
    socket.emit('message',audio,{address:'127.0.0.2',port:4200});
    assert.equal(session.status,'ringing');
    assert.equal(session.packetsReceived,0);
    socket.emit('message',audio,source);
    assert.equal(session.status,'connected');
    assert.equal(session.packetsReceived,1);
  } finally { session.close(); dgram.createSocket = original; }
});

test('stale IDs, nested status 5, unknown answers and late ringing preserve state', () => {
  const session = new gateway.ZaloCallGatewaySession({sessionId:'test2',accountId:'acc',callId:123,calleeId:'customer',api:{}});
  session.status='ringing';
  gateway.registerGatewaySession(session);
  try {
    assert.equal(gateway.handleVoipEvent({act:'endcall',data:{callId:122,calleeId:'customer'}}),null);
    for (const data of [{params:'{"status":5}'},{status:7},{}]) {
      gateway.handleVoipEvent({act:'answer',data:{...data,callId:123}});
      assert.equal(session.status,'ringing');
    }
    let answered=0;
    session.handleAnswerEvent=()=>{ answered++; session.status='connected'; };
    gateway.handleVoipEvent({act:'answer',data:{callId:123,status:0}});
    assert.equal(answered,1);
    gateway.handleVoipEvent({act:'ring_ring',data:{callId:123}});
    assert.equal(session.status,'connected');
    session.status='ended';
    gateway.handleVoipEvent({act:'answer',data:{callId:123,status:0}});
    assert.equal(session.status,'ended');
  } finally {gateway.unregisterGatewaySession(session);}
});
