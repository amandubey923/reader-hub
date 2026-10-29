import React from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Metadata } from "next";
import { BOOKS, getBookById, getRelatedBooks } from "@/data/books";
import BookDetailClient from "./BookDetailClient";
import { getAffiliateInfoForBook } from "@/lib/affiliate-config";

interface BookPageProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return BOOKS.map((book) => ({
    id: book.id,
  }));
}

export async function generateMetadata({
  params,
}: BookPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const book = getBookById(resolvedParams.id);
  if (!book) {
    return {
      title: "Book Not Found | Reader's HUB",
    };
  }

  return {
    title: `${book.title} by ${book.author}`,
    description: book.description.slice(0, 160),
    openGraph: {
      title: `${book.title} | Reader's HUB`,
      description: book.description.slice(0, 160),
      images: [
        {
          url: book.cover,
          alt: book.title,
        },
      ],
    },
  };
}

export default async function BookPage({ params }: BookPageProps) {
  const resolvedParams = await params;
  const book = getBookById(resolvedParams.id);

  if (!book) {
    notFound();
  }

  const related = getRelatedBooks(book, 4);
  const affiliateInfo = getAffiliateInfoForBook(book);

  return <BookDetailClient book={book} relatedBooks={related} affiliateInfo={affiliateInfo} />;
}

