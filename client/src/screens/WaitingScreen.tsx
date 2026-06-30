interface WaitingScreenProps {
  roomId: string
}

export function WaitingScreen({ roomId }: WaitingScreenProps) {
  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#0d0d1a',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, marginBottom: 16 }}>Sala creada</div>
        <div style={{ fontSize: 36, fontWeight: 'bold', color: '#f5c518', marginBottom: 16, letterSpacing: 8 }}>
          {roomId}
        </div>
        <div style={{ color: '#aaa', marginBottom: 8 }}>Comparte este código con tu oponente</div>
        <div style={{ color: '#666', fontSize: 13 }}>Esperando jugador 2...</div>
      </div>
    </div>
  )
}
