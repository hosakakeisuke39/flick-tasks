// 白ベースの上でガラスの屈折が見えるよう、淡い色の光をゆっくり漂わせる
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <span className="blob b1" />
      <span className="blob b2" />
      <span className="blob b3" />
      <span className="blob b4" />
    </div>
  );
}
