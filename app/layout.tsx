export const metadata = {
  title: 'Salka | سالكة',
  description: 'منظومة سالكة لرصد مخاطر الطرق',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
