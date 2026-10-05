import Image from "next/image";
import logo from "./logo/logo.jpg";

export default function BrandLogo() {
  return (
    <div className="brand-mark" role="img" aria-label="Professional Tax Partner logo">
      <Image src={logo} alt="" fill sizes="39px" className="brand-mark-image" />
    </div>
  );
}
